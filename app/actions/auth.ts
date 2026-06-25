"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

import { createSession, destroySession, requireUser, setActiveProject } from "@/lib/auth";
import { query } from "@/lib/db";
import { numberValue, textValue } from "@/lib/forms";

export async function loginAction(formData: FormData) {
  const email = textValue(formData, "email").toLowerCase();
  const password = textValue(formData, "password");

  const users = await query<{
    id: number;
    password_hash: string;
    active: number;
  }>("SELECT id, password_hash, active FROM users WHERE email = ? LIMIT 1", [email]);

  const user = users[0];
  if (!user || !user.active) redirect("/login?error=invalid");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) redirect("/login?error=invalid");

  await createSession(Number(user.id));
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setActiveProjectAction(formData: FormData) {
  const user = await requireUser();
  const projectId = numberValue(formData, "projectId");
  await setActiveProject(projectId, user);
  redirect("/dashboard");
}
