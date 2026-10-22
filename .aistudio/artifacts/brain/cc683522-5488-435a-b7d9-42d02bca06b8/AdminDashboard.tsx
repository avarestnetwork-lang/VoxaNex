import React, { useState } from 'react';

export const AdminDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) setIsAuthenticated(true);
    else alert('Unauthorized');
  };

  if (!isAuthenticated) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-900 text-white">
        <form onSubmit={handleLogin} className="p-8 bg-gray-800 rounded shadow-md">
          <h2 className="text-2xl mb-4">Administrator Login</h2>
          <input type="text" placeholder="Username" className="block w-full p-2 mb-2 bg-gray-700" value={username} onChange={e => setUsername(e.target.value)} />
          <input type="password" placeholder="Password" className="block w-full p-2 mb-4 bg-gray-700" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="w-full p-2 bg-blue-600 rounded">Login</button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-900 text-white h-screen">
      <h1 className="text-3xl mb-6">Admin Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-gray-800 rounded">Metrics: Not yet implemented</div>
      </div>
    </div>
  );
};
