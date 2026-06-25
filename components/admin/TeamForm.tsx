"use client";

import { useMemo, useState } from "react";

import { createTeamAction, deleteTeamAction, updateTeamAction } from "@/app/actions/admin";

type Option = {
  label: string;
  value: string | number;
};

type TeamMember = {
  id: number;
  user_id: number;
  role: string;
  user_name: string;
  email: string;
  role_name: string;
  base_role_label: string;
};

type Team = {
  id: number;
  name: string;
  description: string | null;
  members: TeamMember[];
};

type DraftMember = {
  key: string;
  userId: string;
  role: string;
};

function emptyMember(roleOptions: Option[]): DraftMember {
  return {
    key: crypto.randomUUID(),
    userId: "",
    role: String(roleOptions[0]?.value || "")
  };
}

export function TeamManager({
  users,
  roleOptions,
  teams
}: {
  users: Option[];
  roleOptions: Option[];
  teams: Team[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [members, setMembers] = useState<DraftMember[]>(() => [emptyMember(roleOptions)]);

  const teamMembersByTeam = useMemo(
    () =>
      new Map(
        teams.map((team) => [
          team.id,
          team.members.map((member) => `${member.user_name} (${member.role_name})`).join(", ")
        ])
      ),
    [teams]
  );

  function openCreate() {
    setEditing(null);
    setMembers([emptyMember(roleOptions)]);
    setOpen(true);
  }

  function openEdit(team: Team) {
    setEditing(team);
    setMembers(
      team.members.length
        ? team.members.map((member) => ({
            key: String(member.id),
            userId: String(member.user_id),
            role: member.role
          }))
        : [emptyMember(roleOptions)]
    );
    setOpen(true);
  }

  function updateMember(key: string, field: "userId" | "role", value: string) {
    setMembers((current) =>
      current.map((member) => (member.key === key ? { ...member, [field]: value } : member))
    );
  }

  function removeMember(key: string) {
    setMembers((current) => {
      const next = current.filter((member) => member.key !== key);
      return next.length ? next : [emptyMember(roleOptions)];
    });
  }

  const canSubmit = users.length > 0 && roleOptions.length > 0;

  return (
    <>
      <div className="button-row">
        <button type="button" onClick={openCreate}>
          Crear Equipo de Trabajo
        </button>
      </div>

      {teams.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Equipo</th>
                <th>Integrantes</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    {team.name}
                    {team.description ? (
                      <>
                        <br />
                        <span className="muted">{team.description}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{teamMembersByTeam.get(team.id) || "Sin integrantes"}</td>
                  <td>
                    <div className="button-row compact-row">
                      <button className="button-secondary" type="button" onClick={() => openEdit(team)}>
                        Editar
                      </button>
                      <form action={deleteTeamAction}>
                        <input type="hidden" name="team_id" value={team.id} />
                        <button className="button-danger" type="submit">
                          Eliminar
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <strong>Sin equipos</strong>
          <p>Crea un equipo para reutilizarlo en varios proyectos.</p>
        </div>
      )}

      {open ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title">
            <form action={editing ? updateTeamAction : createTeamAction} className="grid">
              {editing ? <input type="hidden" name="team_id" value={editing.id} /> : null}
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Equipo reutilizable</p>
                  <h2 id="team-modal-title">{editing ? "Editar Equipo de Trabajo" : "Crear Equipo de Trabajo"}</h2>
                </div>
                <button className="button-secondary" type="button" onClick={() => setOpen(false)}>
                  Cerrar
                </button>
              </div>

              <label className="field">
                <span>Nombre del equipo</span>
                <input name="name" required defaultValue={editing?.name || ""} placeholder="Equipo Ideal" />
              </label>
              <label className="field">
                <span>Descripcion</span>
                <textarea name="description" rows={3} defaultValue={editing?.description || ""} />
              </label>

              <div className="member-editor">
                <div className="member-editor-header">
                  <strong>Usuarios y roles</strong>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => setMembers((current) => [...current, emptyMember(roleOptions)])}
                    disabled={!canSubmit}
                  >
                    Agregar usuario
                  </button>
                </div>

                {members.map((member) => (
                  <div className="member-row" key={member.key}>
                    <label className="field">
                      <span>Usuario</span>
                      <select
                        name="member_user_id"
                        required
                        value={member.userId}
                        onChange={(event) => updateMember(member.key, "userId", event.target.value)}
                      >
                        <option value="">Selecciona usuario</option>
                        {users.map((user) => (
                          <option key={user.value} value={user.value}>
                            {user.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Rol</span>
                      <select
                        name="member_role"
                        required
                        value={member.role}
                        onChange={(event) => updateMember(member.key, "role", event.target.value)}
                      >
                        {roleOptions.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button-danger"
                      type="button"
                      onClick={() => removeMember(member.key)}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>

              <div className="button-row">
                <button type="submit" disabled={!canSubmit}>
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
