import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Tailwind Vite plugin expands the utility classes used throughout the UI.
// Without it, the page renders as unstyled HTML in development.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
