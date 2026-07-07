type NodeSqliteColumn = { name: string };

type NodeSqliteStatement = {
  all: (...params: unknown[]) => unknown[][];
  run: (...params: unknown[]) => unknown;
  columns: () => NodeSqliteColumn[];
  setReturnArrays: (enabled: boolean) => void;
};

type NodeSqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => NodeSqliteStatement;
  close: () => void;
};

type NodeSqliteModule = {
  DatabaseSync: new (location: string) => NodeSqliteDatabase;
};

export type NativeSqliteExecResult = Array<{
  columns: string[];
  values: unknown[][];
}>;

export type NativeSqliteDatabase = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => NativeSqliteExecResult;
  close: () => void;
};

function loadNodeSqlite(): NodeSqliteModule {
  return require("node:sqlite") as NodeSqliteModule;
}

export function openNativeSqliteDatabase(databasePath: string): NativeSqliteDatabase {
  const { DatabaseSync } = loadNodeSqlite();
  const database = new DatabaseSync(databasePath);

  return {
    run(sql: string, params?: unknown[]): void {
      if (params && params.length > 0) {
        database.prepare(sql).run(...params);
        return;
      }
      database.exec(sql);
    },
    exec(sql: string): NativeSqliteExecResult {
      const statement = database.prepare(sql);
      statement.setReturnArrays(true);
      return [{
        columns: statement.columns().map((column) => column.name),
        values: statement.all(),
      }];
    },
    close(): void {
      database.close();
    },
  };
}
