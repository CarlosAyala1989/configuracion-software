import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SGCS DevOps",
  description: "Sistema de Gestion de la Configuracion de Software con flujo agil de cambios",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
