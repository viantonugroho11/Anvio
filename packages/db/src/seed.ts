import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { createDb, agents, personas, skills, agentSkills, users } from './index.js';
import { parseAgentDefinition, parsePersonaDefinition, parseSkillDefinition } from '@anvio/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configsRoot = path.join(__dirname, '../../../configs');

function loadYamlDir<T>(dir: string, parser: (input: unknown) => T): T[] {
  const fullPath = path.join(configsRoot, dir);
  if (!fs.existsSync(fullPath)) return [];
  return fs
    .readdirSync(fullPath)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => parser(parseYaml(fs.readFileSync(path.join(fullPath, f), 'utf-8'))));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const db = createDb(connectionString);

  // Seed admin user
  const existingUser = await db.select().from(users).where(eq(users.email, 'admin@anvio.local'));
  if (existingUser.length === 0) {
    await db.insert(users).values({
      email: 'admin@anvio.local',
      passwordHash: await bcrypt.hash('admin123', 10),
      roles: ['admin', 'user'],
    });
    console.log('Created admin user: admin@anvio.local / admin123');
  }

  // Seed personas
  const personaDefs = loadYamlDir('personas', parsePersonaDefinition);
  for (const def of personaDefs) {
    const existing = await db.select().from(personas).where(eq(personas.slug, def.metadata.slug));
    if (existing.length === 0) {
      await db.insert(personas).values({ slug: def.metadata.slug, profile: def.spec });
      console.log(`Seeded persona: ${def.metadata.slug}`);
    }
  }

  // Seed skills
  const skillDefs = loadYamlDir('skills', parseSkillDefinition);
  const skillIdMap = new Map<string, string>();
  for (const def of skillDefs) {
    const existing = await db.select().from(skills).where(eq(skills.slug, def.metadata.slug));
    if (existing.length === 0) {
      const [inserted] = await db
        .insert(skills)
        .values({ slug: def.metadata.slug, definition: def.spec })
        .returning();
      skillIdMap.set(def.metadata.slug, inserted.id);
      console.log(`Seeded skill: ${def.metadata.slug}`);
    } else {
      skillIdMap.set(def.metadata.slug, existing[0].id);
    }
  }

  // Seed agents
  const agentDefs = loadYamlDir('agents', parseAgentDefinition);
  for (const def of agentDefs) {
    const existing = await db.select().from(agents).where(eq(agents.name, def.metadata.name));
    if (existing.length === 0) {
      const [inserted] = await db
        .insert(agents)
        .values({ name: def.metadata.name, spec: def.spec, version: 1 })
        .returning();

      for (const skillSlug of def.spec.skills) {
        const skillId = skillIdMap.get(skillSlug);
        if (skillId) {
          await db.insert(agentSkills).values({ agentId: inserted.id, skillId });
        }
      }
      console.log(`Seeded agent: ${def.metadata.name}`);
    }
  }

  console.log('Seed complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
