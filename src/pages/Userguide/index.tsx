import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import Userguide from './Userguide';
import '@fontsource-variable/public-sans';
import '@fontsource/fragment-mono';
import './index.css';
import contentScript from '../Content/script';

const container = document.getElementById('app-container') as HTMLElement;
const root = createRoot(container);
root.render(
  <StrictMode>
    <Userguide />
  </StrictMode>
);
requestIdleCallback(contentScript);
