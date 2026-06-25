import "server-only";

import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type GlobalWithPool = typeof globalThis & {
  sgcsPool?: Pool;
};

export type SqlParam = string | number | boolean | Date | Buffer | null | undefined;

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

export function getPool() {
  const globalForPool = globalThis as GlobalWithPool;
  if (!globalForPool.sgcsPool) {
    globalForPool.sgcsPool = mysql.createPool({
      host: env("MYSQL_HOST"),
      port: Number(env("MYSQL_PORT", "3306")),
      user: env("MYSQL_USER"),
      password: env("MYSQL_PASSWORD"),
      database: env("MYSQL_DATABASE", "sgcs_devops"),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }

  return globalForPool.sgcsPool;
}

export async function query<T>(sql: string, params: SqlParam[] = []) {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, params as never);
  return rows as T[];
}

export async function execute(sql: string, params: SqlParam[] = []) {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params as never);
  return result;
}

export async function transaction<T>(callback: (connection: PoolConnection) => Promise<T>) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
