import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

// We import the same logic functions from the old adminUsers file.
// But we will move the state into Preact.
// Actually, since the legacy code has `ADMIN_USERS_STATE` and actions, 
// we can either call the legacy functions or rewrite them entirely.
// It's cleaner to rewrite the UI layer and keep the data fetching logic outside,
// OR pull the logic inside the component. Since it's a Proof of Concept, let's pull the logic in.

export function AdminUsers({ stateObj, onLoad, onInvite, onSetRole, onTogglePerm, onAddClid, onRemoveClid, onForceSignOut }: any) {
  const { isAdmin, CLID_MAP } = window.STATE;

  if (!isAdmin) return null;

  const S = stateObj;

  if (!S.loaded && !S.loading && !S.error) {
    return (
      <div class="agy-style-1">
        <button class="crud-btn crud-btn-add" onClick={onLoad}>👥 Cargar usuarios</button>
        <span class="agy-style-2">Se consulta al servidor solo cuando lo pedís.</span>
      </div>
    );
  }

  if (S.loading) {
    return <div class="agy-style-3">Cargando usuarios…</div>;
  }

  if (S.error) {
    return (
      <div class="agy-style-4">
        {S.error}
        <button class="crud-btn agy-style-5" onClick={onLoad}>Reintentar</button>
      </div>
    );
  }

  const permsByUser = new Map();
  S.perms.forEach((p: any) => {
    if (!permsByUser.has(p.user_id)) permsByUser.set(p.user_id, new Set());
    permsByUser.get(p.user_id).add(p.permission);
  });
  
  const clidsByUser = new Map();
  S.mappings.forEach((m: any) => {
    if (!clidsByUser.has(m.user_id)) clidsByUser.set(m.user_id, []);
    clidsByUser.get(m.user_id).push(m);
  });

  const AU_ROLES = ["admin", "kam", "viewer", "partner"];
  const AU_PERMISOS = [
    ["write:performance", "Subir rendimiento"],
    ["write:metas",       "Editar metas"],
    ["write:config",      "Editar configuración"],
    ["write:seguimiento", "Editar seguimiento"],
    ["delete:data",       "Borrado masivo"],
    ["manage:users",      "Gestionar usuarios"]
  ];

  return (
    <div>
      {/* ── Invitar ── */}
      <div class="section agy-style-6">
        <div class="agy-style-7">✉️ Invitar usuario</div>
        <div class="agy-style-8">
          <input class="crud-input agy-style-9" id="auInviteEmail" type="email" placeholder="email@dominio.com" />
          <select class="crud-input agy-style-10" id="auInviteRole">
            {AU_ROLES.map(r => (
              <option value={r} selected={r === "viewer"}>{r}</option>
            ))}
          </select>
          <button class="crud-btn crud-btn-add" onClick={onInvite}>Enviar invitación</button>
        </div>
        <div class="agy-style-11">
          Recibe un mail para fijar su contraseña. Para un <strong>partner</strong>, después asignale sus CLIDs abajo — sin CLIDs asignados no ve ningún dato (por diseño).
        </div>
      </div>

      {/* ── Tabla de usuarios ── */}
      <div class="tbl-wrap">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Email</th>
              <th class="agy-style-12">Rol</th>
              <th>Permisos extra</th>
              <th>CLIDs (partner)</th>
              <th class="agy-style-13">Sesión</th>
            </tr>
          </thead>
          <tbody>
            {S.users.map((u: any) => {
              const uid = u.id;
              const misP = permsByUser.get(u.id) || new Set();
              const misC = clidsByUser.get(u.id) || [];
              const esPartner = u.role === "partner";
              const esAdmin = u.role === "admin";

              return (
                <tr key={uid}>
                  <td class="agy-style-24">
                    {u.email || ""}
                    <div class="agy-style-25">
                      {u.lastSignInAt ? "último ingreso " + String(u.lastSignInAt).slice(0, 10) : "nunca ingresó"}
                    </div>
                  </td>
                  <td>
                    <select class="crud-input agy-style-26" onChange={(e: any) => onSetRole(uid, e.target.value)}>
                      {AU_ROLES.map(r => (
                        <option value={r} selected={r === u.role}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {AU_PERMISOS.map(([key, label]) => {
                      const on = misP.has(key);
                      if (esAdmin) {
                        return <span class="agy-style-14" title="admin ya tiene todos los permisos">{label}</span>;
                      }
                      return (
                        <label class="agy-style-15" key={key}>
                          <input type="checkbox" checked={on} onChange={(e: any) => onTogglePerm(uid, key, e.target.checked)} />
                          <span style={{ fontWeight: on ? 700 : 'normal', color: on ? '#166534' : '#666' }}>{label}</span>
                        </label>
                      );
                    })}
                  </td>
                  <td>
                    {esPartner ? (
                      <div>
                        {misC.length > 0 ? misC.map((m: any) => (
                          <span class="agy-style-16" key={m.id}>
                            {m.clid}
                            <span class="agy-style-17">{CLID_MAP[m.clid] || ""}</span>
                            <button onClick={() => onRemoveClid(m.id)} title="Quitar" class="agy-style-18">×</button>
                          </span>
                        )) : (
                          <span class="agy-style-19">⚠ sin CLIDs: no ve nada</span>
                        )}
                        <div class="agy-style-20">
                          <input class="crud-input agy-style-21" id={`auClid_${uid}`} placeholder="CLID" />
                          <button class="crud-btn agy-style-22" onClick={() => {
                            const inp = document.getElementById(`auClid_${uid}`) as HTMLInputElement;
                            if (inp) onAddClid(uid, inp.value);
                          }}>+ Asignar</button>
                        </div>
                      </div>
                    ) : (
                      <span class="agy-style-23">— solo rol partner —</span>
                    )}
                  </td>
                  <td class="agy-style-27">
                    <button class="crud-btn agy-style-22" onClick={() => onForceSignOut(uid)} title="Cierra sus sesiones para que un cambio de rol aplique ya">Cerrar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="agy-style-28">
        El rol viaja dentro del token de sesión: un cambio recién aplica cuando la persona vuelve a iniciar sesión
        (o si le cerrás la sesión con "Cerrar"). Los permisos extra y los CLIDs, en cambio, aplican al instante.
      </div>
      <div class="agy-style-29">
        <button class="crud-btn" onClick={onLoad}>↻ Refrescar</button>
      </div>
    </div>
  );
}
