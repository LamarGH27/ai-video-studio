import { z } from 'zod';
import { PROJECT_STATUS_ORDER } from '@/lib/projects/status';
import type { ProjectStatus } from '@/types/database';

const statusValues = PROJECT_STATUS_ORDER as readonly [ProjectStatus, ...ProjectStatus[]];

export const updateProjectStatusSchema = z.object({
  projectId: z.uuid(),
  status: z.enum(statusValues),
});

export type UpdateProjectStatusInput = z.infer<typeof updateProjectStatusSchema>;
