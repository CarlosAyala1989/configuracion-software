import {
  BadgePlus,
  Boxes,
  ClipboardCheck,
  FolderKanban,
  FolderPlus,
  GitBranch,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  UserCog,
  UserPlus,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { setActiveProjectAction, logoutAction } from "@/app/actions/auth";
import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getUnreadNotifications } from "@/lib/notifications";
import { roleLabel, type ProjectRole } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  roles?: ProjectRole[];
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/configuration", label: "Elementos SCM", icon: <Network size={18} /> },
  { href: "/requests#crear-solicitud", label: "Crear solicitud", icon: <BadgePlus size={18} />, roles: ["SOLICITANTE"] },
  { href: "/requests#mis-solicitudes", label: "Mis solicitudes", icon: <ListChecks size={18} />, roles: ["SOLICITANTE"] },
  { href: "/pm#revision-solicitudes", label: "Revision PM", icon: <FolderKanban size={18} />, roles: ["JEFE_PROYECTO"] },
  { href: "/pm#cierres-pendientes", label: "Cierres PM", icon: <UserCheck size={18} />, roles: ["JEFE_PROYECTO"] },
  { href: "/ccb#revision-ccb", label: "Revision CCB", icon: <ShieldCheck size={18} />, roles: ["CCB"] },
  { href: "/tech-lead#crear-backlog", label: "Crear backlog", icon: <SlidersHorizontal size={18} />, roles: ["LIDER_TECNICO"] },
  { href: "/tech-lead#liberar-pm", label: "Liberar a PM", icon: <UserCheck size={18} />, roles: ["LIDER_TECNICO"] },
  { href: "/tech-lead#backlogs", label: "Backlogs DEV/QA", icon: <GitBranch size={18} />, roles: ["LIDER_TECNICO"] },
  { href: "/developer#backlog-dev", label: "Backlog DEV", icon: <GitBranch size={18} />, roles: ["DESARROLLADOR"] },
  { href: "/developer#mis-reportes", label: "Mis reportes", icon: <History size={18} />, roles: ["DESARROLLADOR"] },
  { href: "/qa#backlog-qa", label: "Backlog QA", icon: <ClipboardCheck size={18} />, roles: ["QA"] },
  { href: "/qa#historial-qa", label: "Historial QA", icon: <History size={18} />, roles: ["QA"] },
  { href: "/admin/users", label: "Crear usuarios", icon: <UserPlus size={18} />, adminOnly: true },
  { href: "/admin/projects", label: "Crear proyectos", icon: <FolderPlus size={18} />, adminOnly: true },
  { href: "/admin/assignments", label: "Asignar roles", icon: <UserCog size={18} />, adminOnly: true },
  { href: "/admin/teams", label: "Equipos de trabajo", icon: <Boxes size={18} />, adminOnly: true },
  { href: "/admin/roles", label: "Crear roles", icon: <ShieldCheck size={18} />, adminOnly: true }
];

export async function AppShell({
  children,
  showProjectSwitcher = false
}: {
  children: ReactNode;
  showProjectSwitcher?: boolean;
}) {
  const user = await requireUser();
  const { project, projects, role } = await getActiveProject(user);
  const notifications = await getUnreadNotifications(user.id);

  const visibleNav = navItems.filter((item) => {
    if (item.adminOnly) return user.is_admin;
    if (!item.roles) return true;
    return canUseRole(user, role, item.roles);
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">S</span>
          <span>
            <strong>SGCS DevOps</strong>
            <small>Control agil de cambios</small>
          </span>
        </Link>

        <nav className="nav-list" aria-label="Principal">
          {visibleNav.map((item) => (
            <Link key={item.href} href={item.href} className="nav-item">
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <UsersRound size={16} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <form action={logoutAction}>
            <button className="icon-text-button full" type="submit">
              <LogOut size={16} />
              Salir
            </button>
          </form>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Sistema de Gestion de la Configuracion de Software</p>
            <h1>{project?.title || "Sin proyecto activo"}</h1>
            {project ? (
              <p className="muted">
                {project.methodology} · {formatDate(project.start_date)} - {formatDate(project.end_date)}
                {role ? ` · Rol: ${roleLabel(role, project.role_labels)}` : ""}
              </p>
            ) : (
              <p className="muted">Crea o asigna un proyecto para iniciar el flujo.</p>
            )}
          </div>

          <div className="topbar-actions">
            {showProjectSwitcher && projects.length > 0 ? (
              <form action={setActiveProjectAction} className="project-switcher">
                <select name="projectId" defaultValue={project?.id}>
                  {projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <button type="submit">Abrir</button>
              </form>
            ) : null}
          </div>
        </header>

        {notifications.length > 0 ? (
          <section className="notification-strip" aria-label="Notificaciones pendientes">
            {notifications.slice(0, 3).map((notification) => (
              <Link
                key={notification.id}
                href={
                  notification.change_request_id
                    ? `/requests/${notification.change_request_id}`
                    : "/dashboard"
                }
              >
                <strong>{notification.title}</strong>
                <span>{notification.body}</span>
              </Link>
            ))}
          </section>
        ) : null}

        {children}
      </main>
    </div>
  );
}
