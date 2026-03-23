import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as db from './db';

const App = () => {
  const [view, setView] = useState('list');
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

  const renderView = () => {
    switch (view) {
      case 'list':
        return <ClientList onSelectClient={(id) => { setSelectedClientId(id); setView('detail'); }} />;
      case 'new-client':
        return <NewClientForm onSaved={() => setView('list')} />;
      case 'entrance':
        return <RegisterEntrance />;
      case 'detail':
        return <ClientDetail clientId={selectedClientId!} onBack={() => setView('list')} />;
      default:
        return <ClientList onSelectClient={(id) => { setSelectedClientId(id); setView('detail'); }} />;
    }
  };

  return (
    <div>
      <h1>Gimnasio Control de Entrada y Pagos</h1>
      <div className="menu">
        <button onClick={() => setView('list')}>Ver Todos</button>
        <button onClick={() => setView('entrance')}>Registrar Entrada</button>
        <button onClick={() => setView('new-client')}>Nuevo Cliente</button>
      </div>
      <hr />
      {renderView()}
    </div>
  );
};

const ClientList = ({ onSelectClient }: { onSelectClient: (id: number) => void }) => {
  const [clients, setClients] = useState<any[]>([]);

  useEffect(() => {
    db.getClients().then(setClients);
  }, []);

  return (
    <div>
      <h2>Clientes</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>DNI</th>
            <th>Fin de Suscripción</th>
            <th>Monto Pactado</th>
            <th>Monto Pagado</th>
          </tr>
        </thead>
        <tbody>
          {clients.map(client => (
            <tr key={client.id} className="clickable" onClick={() => onSelectClient(client.id)}>
              <td>{client.name}</td>
              <td>{client.dni}</td>
              <td>{client.end_date || 'Sin suscripción activa'}</td>
              <td>{client.pacted_amount != null ? `$${client.pacted_amount}` : '-'}</td>
              <td style={{ color: client.pacted_amount != null && client.paid_amount < client.pacted_amount ? 'red' : 'inherit' }}>
                {client.pacted_amount != null ? `$${client.paid_amount}` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const NewClientForm = ({ onSaved }: { onSaved: () => void }) => {
  const [name, setName] = useState('');
  const [dni, setDni] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name && dni) {
      await db.createClient({ name, dni });
      onSaved();
    }
  };

  return (
    <div>
      <h2>Crear Nuevo Cliente</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Nombre:</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>DNI:</label>
          <input type="text" value={dni} onChange={e => setDni(e.target.value)} required />
        </div>
        <button type="submit">Guardar Cliente</button>
      </form>
    </div>
  );
};

const RegisterEntrance = () => {
  const [dni, setDni] = useState('');
  const [result, setResult] = useState<{ success: boolean; message?: string; name?: string; warning?: string } | null>(null);

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await db.registerEntrance(dni);
    setResult(res);
  };

  return (
    <div>
      <h2>Registrar Entrada</h2>
      <form onSubmit={handleCheck}>
        <div className="form-group">
          <label>DNI:</label>
          <input type="text" value={dni} onChange={e => setDni(e.target.value)} required autoFocus />
        </div>
        <button type="submit">Verificar</button>
      </form>
      {result && (
        <div style={{ marginTop: '20px', color: result.success ? 'green' : 'red' }}>
          {result.success ? `¡ÉXITO! Bienvenido/a ${result.name}${result.warning || ''}` : result.message}
        </div>
      )}
    </div>
  );
};

const ClientDetail = ({ clientId, onBack }: { clientId: number, onBack: () => void }) => {
  const [client, setClient] = useState<any>(null);
  const [showAddSub, setShowAddSub] = useState(false);
  const [selectedSubForPayment, setSelectedSubForPayment] = useState<number | null>(null);

  const loadData = () => {
    db.getClientDetails(clientId).then(setClient);
  };

  useEffect(() => {
    loadData();
  }, [clientId]);

  const handleDeleteSub = async (subId: number) => {
    if (confirm('¿Está seguro de que desea eliminar esta suscripción?')) {
      await db.deleteSubscription({ clientId, subscriptionId: subId });
      loadData();
    }
  };

  if (!client) return <div>Cargando...</div>;

  return (
    <div>
      <button onClick={onBack}>&larr; Volver</button>
      <h2>Detalle del Cliente: {client.name} (DNI: {client.dni})</h2>
      
      <h3>Suscripciones</h3>
      <button onClick={() => setShowAddSub(true)}>Agregar Nueva Suscripción</button>
      
      {showAddSub && (
        <AddSubForm 
          clientId={clientId} 
          onSaved={() => { setShowAddSub(false); loadData(); }} 
          onCancel={() => setShowAddSub(false)} 
        />
      )}

      {selectedSubForPayment && (
        <AddPaymentForm 
          subscriptionId={selectedSubForPayment} 
          onSaved={() => { setSelectedSubForPayment(null); loadData(); }} 
          onCancel={() => setSelectedSubForPayment(null)} 
        />
      )}

      <div style={{ marginTop: '20px' }}>
        {client.subscriptions.map((sub: any) => (
          <div key={sub.id} className={`sub-card ${client.active_subscription_id === sub.id ? 'active-sub' : ''}`}>
            <div><strong>Intervalo:</strong> {sub.interval} meses | <strong>Monto:</strong> ${sub.pacted_amount}</div>
            <div><strong>Fechas:</strong> {sub.start_date} a {sub.end_date}</div>
            {client.active_subscription_id === sub.id && <div style={{ color: 'green', fontWeight: 'bold' }}>Suscripción Activa</div>}
            
            <div className="payment-list">
              <strong>Pagos:</strong> {sub.payments.length === 0 && 'Ninguno'}
              <ul>
                {sub.payments.map((p: any) => (
                  <li key={p.id}>${p.amount} el {p.date_of_payment}</li>
                ))}
              </ul>
            </div>
            
            <div style={{ marginTop: '10px' }}>
              <button onClick={() => setSelectedSubForPayment(sub.id)}>Registrar Pago</button>
              <button onClick={() => handleDeleteSub(sub.id)} style={{ marginLeft: '10px', color: 'red' }}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AddSubForm = ({ clientId, onSaved, onCancel }: { clientId: number, onSaved: () => void, onCancel: () => void }) => {
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [interval, setIntervalVal] = useState(1);
  const [amount, setAmount] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + interval);
    const endDate = d.toISOString().split('T')[0];
    await db.addSubscription({ clientId, startDate, endDate, amount, interval });
    onSaved();
  };

  return (
    <div className="sub-card">
      <h4>Nueva Suscripción</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Fecha de Inicio:</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Intervalo (Meses):</label>
          <input type="number" value={interval} onChange={e => setIntervalVal(parseInt(e.target.value))} required />
        </div>
        <div className="form-group">
          <label>Monto Pactado:</label>
          <input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value))} required />
        </div>
        <button type="submit">Guardar</button>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </form>
    </div>
  );
};

const AddPaymentForm = ({ subscriptionId, onSaved, onCancel }: { subscriptionId: number, onSaved: () => void, onCancel: () => void }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await db.addPayment({ subscriptionId, dateOfPayment: date, amount });
    onSaved();
  };

  return (
    <div className="sub-card">
      <h4>Registrar Pago</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Fecha de Pago:</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Monto:</label>
          <input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value))} required />
        </div>
        <button type="submit">Guardar Pago</button>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </form>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
