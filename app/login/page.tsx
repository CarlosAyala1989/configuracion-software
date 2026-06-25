import { redirect } from "next/navigation";

import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <span className="brand-mark">S</span>
          <span>
            <strong>SGCS DevOps</strong>
            <small>Gestion agil de solicitudes y trazabilidad</small>
          </span>
        </div>
        <h1>Ingresar</h1>
        <p className="muted">Usa el usuario creado por el administrador del sistema.</p>
        {params.error ? <div className="error-banner">Correo o contrasena incorrectos.</div> : null}
        <form action={loginAction} className="grid">
          <label className="field">
            <span>Correo</span>
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label className="field">
            <span>Contrasena</span>
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <button type="submit">Entrar</button>
        </form>
      </section>
    </main>
  );
}
