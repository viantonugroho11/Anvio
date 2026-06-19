export interface StorageObject {
  key: string;
  data: string | Buffer;
  contentType?: string;
  modifiedAt?: Date;
}

export interface StorageProvider {
  readonly providerId: string;
  read(key: string): Promise<string | null>;
  write(key: string, data: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  readJson<T>(key: string): Promise<T | null>;
  writeJson(key: string, data: unknown): Promise<void>;
}

export interface ConfigLoader {
  listAgents(): Promise<string[]>;
  loadAgent(name: string): Promise<unknown>;
  loadPersona(slug: string): Promise<unknown>;
  loadSkill(slug: string): Promise<unknown>;
  listSkills(): Promise<string[]>;
  listPersonas(): Promise<string[]>;
}
