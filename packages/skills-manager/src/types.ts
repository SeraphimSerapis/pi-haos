export type SkillSource = 'bundled' | 'installed' | 'user';

export interface SkillPermissions {
  read_config?: boolean;
  read_entities?: boolean;
  write_staging?: boolean;
  network_access?: boolean;
}

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  permissions: string[];
  compatibility: { min_app_version?: string; min_pi_version?: string };
}

export interface SkillRecord {
  manifest: SkillManifest;
  content: string;
}
