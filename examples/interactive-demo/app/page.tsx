"use client";

import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function TokenShieldDemo() {
  const [logs, setLogs] = useState<string[]>([]);
  const [cost, setCost] = useState(0);
  const [saved, setSaved] = useState(0);
  const [input, setInput] = useState("What is the capital of France?");
  const [loading, setLoading] = useState(false);

  const simulateRequest = async () => {
    setLoading(true);
    addLog(`> Requesting: "${input}"`);
    
    // Simulate network delay and TokenShield processing
    setTimeout(() => {
      const isCached = Math.random() > 0.5;
      
      if (isCached) {
        addLog(`✅ CACHE HIT! Served in 2ms. Cost: $0.00`);
        setSaved(s => s + 0.01);
      } else {
        addLog(`📡 API CALL. Served in 450ms. Cost: $0.01`);
        setCost(c => c + 0.01);
      }
      setLoading(false);
    }, 600);
  };

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 10));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <header className="text-center">
          <h1 className="text-3xl font-bold text-blue-600">TokenShield Interactive Demo</h1>
          <p className="text-gray-600 mt-2">Simulate real-world LLM traffic and see cost savings in action.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Controls */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">🔮 Simulator</h2>
            <textarea 
              value={input}
              onChange={e => setInput(e.target.value)}
              className="w-full p-3 border rounded-lg mb-4 h-24"
            />
            <button 
              onClick={simulateRequest}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? "Processing..." : "Send Request (Simulate)"}
            </button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              * In this demo, requests have a 50% chance of hitting the semantic cache.
            </p>
          </div>

          {/* Stats */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">💰 Real-Time Savings</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-sm text-red-600">Total Cost</div>
                <div className="text-2xl font-bold text-red-700">${cost.toFixed(2)}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-green-600">Total Saved</div>
                <div className="text-2xl font-bold text-green-700">${saved.toFixed(2)}</div>
              </div>
            </div>
            
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm h-48 overflow-y-auto">
              {logs.length === 0 ? <span className="opacity-50">System ready... waiting for requests.</span> : logs.map((l, i) => (
                <div key={i} className="mb-1">{l}</div>
              ))}
            </div>
          </div>

        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-lg border text-center">
            <div className="text-2xl mb-2">⚡</div>
            <h3 className="font-bold">Zero Latency</h3>
            <p className="text-sm text-gray-600">Middleware runs in < 5ms</p>
          </div>
          <div className="p-4 bg-white rounded-lg border text-center">
            <div className="text-2xl mb-2">🔒</div>
            <h3 className="font-bold">No Lock-In</h3>
            <p className="text-sm text-gray-600">Remove anytime via npm</p>
          </div>
          <div className="p-4 bg-white rounded-lg border text-center">
            <div className="text-2xl mb-2">👤</div>
            <h3 className="font-bold">User Budgets</h3>
            <p className="text-sm text-gray-600">Limit spend per-tenant</p>
          </div>
        </div>

      </div>
    </div>
  );
}
