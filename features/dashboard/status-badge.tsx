import { Badge } from '@/components/ui/badge';
import { statusLabel, statusTone } from '@/lib/projects/status';
import { cn } from '@/lib/utils';
import type { ProjectStatus } from '@/types/database';

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return <Badge className={cn(statusTone(status), className)}>{statusLabel(status)}</Badge>;
}
