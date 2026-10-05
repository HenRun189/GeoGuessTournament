import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import HomePage from './pages/HomePage';
import CreatePage from './pages/CreatePage';
import AdminPage from './pages/AdminPage';
import TournamentPage from './pages/TournamentPage';
import OverlayPage from './pages/OverlayPage';
import PlayerPage from './pages/PlayerPage';
import RulesPage from './pages/RulesPage';

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/create', element: <CreatePage /> },
  { path: '/rules', element: <RulesPage /> },
  { path: '/admin/:id', element: <AdminPage /> },
  { path: '/tournament/:id', element: <TournamentPage /> },
  { path: '/player/:tournamentId/:unitId/:slug?', element: <PlayerPage /> },
  { path: '/overlay/:id', element: <OverlayPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
