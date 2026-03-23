const DB_NAME = 'gym-admin';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('clients')) {
        const clientStore = db.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
        clientStore.createIndex('dni', 'dni', { unique: true });
      }
      if (!db.objectStoreNames.contains('subscriptions')) {
        const subStore = db.createObjectStore('subscriptions', { keyPath: 'id', autoIncrement: true });
        subStore.createIndex('client_id', 'client_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('payments')) {
        const payStore = db.createObjectStore('payments', { keyPath: 'id', autoIncrement: true });
        payStore.createIndex('subscription_id', 'subscription_id', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode = 'readonly') {
  const storeNames = Array.isArray(stores) ? stores : [stores];
  return db.transaction(storeNames, mode);
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txComplete(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function getAll<T>(store: IDBObjectStore): Promise<T[]>;
function getAll<T>(index: IDBIndex): Promise<T[]>;
function getAll<T>(source: IDBObjectStore | IDBIndex): Promise<T[]> {
  return req(source.getAll()) as Promise<T[]>;
}

export async function getClients() {
  const db = await openDB();
  const t = tx(db, ['clients', 'subscriptions', 'payments']);
  const clients = await getAll<any>(t.objectStore('clients'));
  const result = [];
  for (const client of clients) {
    let end_date: string | null = null;
    let pacted_amount: number | null = null;
    let paid_amount = 0;
    if (client.active_subscription_id != null) {
      const sub = await req(t.objectStore('subscriptions').get(client.active_subscription_id));
      if (sub) {
        end_date = (sub as any).end_date;
        pacted_amount = (sub as any).pacted_amount;
        const allPayments: any[] = await req(t.objectStore('payments').index('subscription_id').getAll(client.active_subscription_id));
        paid_amount = allPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
      }
    }
    result.push({ ...client, end_date, pacted_amount, paid_amount });
  }
  db.close();
  return result;
}

export async function getClientDetails(clientId: number) {
  const db = await openDB();
  const t = tx(db, ['clients', 'subscriptions', 'payments']);
  const client = await req(t.objectStore('clients').get(clientId)) as any;
  const allSubs = await getAll<any>(t.objectStore('subscriptions'));
  const subs = allSubs.filter((s: any) => s.client_id === clientId);
  for (const sub of subs) {
    const payments: any[] = await new Promise((resolve, reject) => {
      const r = t.objectStore('payments').index('subscription_id').getAll(sub.id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    sub.payments = payments;
  }
  db.close();
  return { ...client, subscriptions: subs };
}

export async function createClient(data: { name: string; dni: string }) {
  const db = await openDB();
  const t = tx(db, 'clients', 'readwrite');
  const id = await req(t.objectStore('clients').add({ name: data.name, dni: data.dni, active_subscription_id: null }));
  await txComplete(t);
  db.close();
  return { id };
}

export async function addSubscription(data: { clientId: number; startDate: string; endDate: string; amount: number; interval: number }) {
  const db = await openDB();
  const t = tx(db, ['subscriptions', 'clients'], 'readwrite');
  const subId = await req(t.objectStore('subscriptions').add({
    client_id: data.clientId,
    start_date: data.startDate,
    end_date: data.endDate,
    pacted_amount: data.amount,
    interval: data.interval,
  }));
  const client = await req(t.objectStore('clients').get(data.clientId)) as any;
  client.active_subscription_id = subId;
  await req(t.objectStore('clients').put(client));
  await txComplete(t);
  db.close();
  return { id: subId };
}

export async function deleteSubscription(data: { clientId: number; subscriptionId: number }) {
  const db = await openDB();
  const t = tx(db, ['subscriptions', 'payments', 'clients'], 'readwrite');
  // delete payments
  const payments: any[] = await new Promise((resolve, reject) => {
    const r = t.objectStore('payments').index('subscription_id').getAll(data.subscriptionId);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  for (const p of payments) {
    await req(t.objectStore('payments').delete(p.id));
  }
  await req(t.objectStore('subscriptions').delete(data.subscriptionId));
  const client = await req(t.objectStore('clients').get(data.clientId)) as any;
  if (client.active_subscription_id === data.subscriptionId) {
    client.active_subscription_id = null;
    await req(t.objectStore('clients').put(client));
  }
  await txComplete(t);
  db.close();
  return { success: true };
}

export async function addPayment(data: { subscriptionId: number; dateOfPayment: string; amount: number }) {
  const db = await openDB();
  const t = tx(db, 'payments', 'readwrite');
  const id = await req(t.objectStore('payments').add({
    subscription_id: data.subscriptionId,
    date_of_payment: data.dateOfPayment,
    amount: data.amount,
  }));
  await txComplete(t);
  db.close();
  return { id };
}

export async function registerEntrance(dni: string) {
  const db = await openDB();
  const t = tx(db, ['clients', 'subscriptions', 'payments']);
  
  // Find client by DNI
  const allClients = await getAll<any>(t.objectStore('clients'));
  const client = allClients.find((c: any) => c.dni === dni);
  
  if (!client || client.active_subscription_id == null) {
    db.close();
    return { success: false, message: 'Cliente no encontrado o sin suscripción activa' };
  }

  const sub = await req(t.objectStore('subscriptions').get(client.active_subscription_id)) as any;
  if (!sub) {
    db.close();
    return { success: false, message: 'Cliente no encontrado o sin suscripción activa' };
  }

  const now = new Date();
  const subStart = new Date(sub.start_date);
  const subEnd = new Date(sub.end_date);

  if (now < subStart || now > subEnd) {
    db.close();
    return { success: false, message: 'Suscripción vencida o aún no activa' };
  }

  let monthsDiff = (now.getFullYear() - subStart.getFullYear()) * 12 + (now.getMonth() - subStart.getMonth());
  if (now.getDate() < subStart.getDate()) {
    monthsDiff--;
  }
  const currentPeriod = Math.max(0, Math.floor(monthsDiff / sub.interval));

  const payments: any[] = await new Promise((resolve, reject) => {
    const r = t.objectStore('payments').index('subscription_id').getAll(sub.id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const paymentsCount = payments.length;
  const paidAmount = payments.reduce((sum: number, p: any) => sum + p.amount, 0);
  const pactedAmount = sub.pacted_amount;

  db.close();

  if (paymentsCount > currentPeriod) {
    const warning = paidAmount < pactedAmount ? ` (Atención: pagó $${paidAmount} de $${pactedAmount})` : '';
    return { success: true, name: client.name, warning };
  } else {
    return { success: false, message: 'Pago pendiente' };
  }
}
