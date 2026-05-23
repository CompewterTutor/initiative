import { useRouter } from "@tanstack/react-router";
import {
  BarChart3,
  CheckSquare,
  GalleryHorizontalEnd,
  Gauge,
  ListTodo,
  PenLine,
  Plus,
  ScrollText,
  Settings,
  UserCog,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getOpenCreateTaskWizard } from "@/components/tasks/CreateTaskWizard";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { useCounterGroupsList } from "@/hooks/useCounters";
import { useAllDocumentIds } from "@/hooks/useDocuments";
import { useGuilds } from "@/hooks/useGuilds";
import { useProjects } from "@/hooks/useProjects";
import { useQueuesList } from "@/hooks/useQueues";
import { useRecents } from "@/hooks/useRecents";
import { useTasks } from "@/hooks/useTasks";
import { getDocumentIcon, getDocumentIconColor } from "@/lib/fileUtils";
import { commandFilter } from "@/lib/fuzzyMatch";
import { guildPath, useGuildPath } from "@/lib/guildUrl";
import { renderRecentIcon } from "@/lib/recentIcon";
import { recentRoute } from "@/lib/recentRoute";

// Module-level callback so other components can open the command center
let openCommandCenter: (() => void) | null = null;
export function getOpenCommandCenter() {
  return openCommandCenter;
}

export function CommandCenter() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(["command", "common"]);
  const router = useRouter();
  const { user } = useAuth();
  const { activeGuild, activeGuildId } = useGuilds();
  const getGuildPath = useGuildPath();

  // Expose open callback for external triggers (e.g. sidebar button)
  useEffect(() => {
    openCommandCenter = () => setOpen(true);
    return () => {
      openCommandCenter = null;
    };
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 3-finger tap to open on mobile/touch devices
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        setOpen(true);
      }
    };
    document.addEventListener("touchstart", handleTouchStart);
    return () => document.removeEventListener("touchstart", handleTouchStart);
  }, []);

  // Data hooks — all use existing cached data except tasks which fetches when dialog opens
  const recentQuery = useRecents({ staleTime: 30_000 });
  const projectsQuery = useProjects(undefined, { staleTime: 60_000 });
  const documentsQuery = useAllDocumentIds({ staleTime: 60_000 });
  const queuesQuery = useQueuesList({ page_size: 100 }, { staleTime: 60_000 });
  const counterGroupsQuery = useCounterGroupsList({ page_size: 100 }, { staleTime: 60_000 });
  const tasksQuery = useTasks(
    {
      page_size: 50,
      conditions: user ? [{ field: "assignee_ids", op: "in_" as const, value: [user.id] }] : [],
    },
    { enabled: open && !!user, staleTime: 30_000 }
  );

  // Suggested = mixed-type recent items, ordered by ``last_viewed_at`` desc
  // (same payload that backs the layout tabs bar).
  const recentItems = recentQuery.data ?? [];
  const projects = projectsQuery.data?.items ?? [];
  const documents = documentsQuery.data ?? [];
  const queues = queuesQuery.data?.items ?? [];
  const counterGroups = counterGroupsQuery.data?.items ?? [];
  const tasks = tasksQuery.data?.items ?? [];

  const isGuildAdmin = activeGuild?.role === "admin";
  const isPlatformAdmin = user?.role === "admin";

  // Static pages
  const pages = useMemo(() => {
    const items = [
      { label: t("pages.myTasks"), path: "/", icon: CheckSquare },
      { label: t("pages.tasksICreated"), path: "/created-tasks", icon: PenLine },
      { label: t("pages.myProjects"), path: "/my-projects", icon: ListTodo },
      { label: t("pages.myDocuments"), path: "/my-documents", icon: ScrollText },
      { label: t("pages.myStats"), path: "/user-stats", icon: BarChart3 },
      { label: t("pages.userSettings"), path: "/profile", icon: UserCog },
      {
        label: t("pages.allProjects"),
        path: getGuildPath("/projects"),
        icon: ListTodo,
      },
      {
        label: t("pages.allDocuments"),
        path: getGuildPath("/documents"),
        icon: ScrollText,
      },
      {
        label: t("pages.allInitiatives"),
        path: getGuildPath("/initiatives"),
        icon: Users,
      },
    ];

    if (isGuildAdmin) {
      items.push({
        label: t("pages.guildSettings"),
        path: "/settings/guild",
        icon: Settings,
      });
    }

    if (isPlatformAdmin) {
      items.push({
        label: t("pages.platformSettings"),
        path: "/settings/admin",
        icon: Settings,
      });
    }

    return items;
  }, [t, getGuildPath, isGuildAdmin, isPlatformAdmin]);

  const handleSelect = (path: string) => {
    setOpen(false);
    void router.navigate({ to: path });
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} filter={commandFilter}>
      <CommandInput
        placeholder={t("placeholder", {
          activeGuildName: activeGuild?.name ?? t("common:appName"),
        })}
      />
      <CommandList>
        <CommandEmpty>{t("noResults")}</CommandEmpty>

        {/* Actions */}
        <CommandGroup heading={t("groups.actions")}>
          <CommandItem
            value="action-add-task"
            onSelect={() => {
              setOpen(false);
              getOpenCreateTaskWizard()?.();
            }}
          >
            <Plus className="text-muted-foreground" />
            <span>{t("actions.addTask")}</span>
          </CommandItem>
        </CommandGroup>

        {/* Suggested — mixed recents across projects/documents/queues/counter
            groups (cmdk hides empty groups automatically when searching). */}
        {recentItems.length > 0 && (
          <CommandGroup heading={t("groups.suggested")}>
            {recentItems.slice(0, 5).map((item) => (
              <CommandItem
                key={`suggested-${item.entity_type}-${item.entity_id}`}
                value={`suggested-${item.entity_type}-${item.entity_id}-${item.name}`}
                keywords={[item.name]}
                onSelect={() => handleSelect(recentRoute(item, activeGuildId))}
              >
                {renderRecentIcon(item) ?? <ListTodo className="text-muted-foreground" />}
                <span>{item.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Pages */}
        <CommandGroup heading={t("groups.pages")}>
          {pages.map((page) => (
            <CommandItem
              key={`page-${page.path}`}
              value={`page-${page.label}`}
              onSelect={() => handleSelect(page.path)}
            >
              <page.icon className="text-muted-foreground" />
              <span>{page.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Projects */}
        <CommandGroup heading={t("groups.projects")}>
          {projects.map((project) => (
            <CommandItem
              key={`project-${project.id}`}
              value={`project-${project.id}-${project.name}`}
              keywords={[
                project.description ?? "",
                project.initiative?.name ?? "",
                ...(project.tags?.map((tag) => tag.name) ?? []),
              ]}
              onSelect={() =>
                handleSelect(
                  activeGuildId
                    ? guildPath(activeGuildId, `/projects/${project.id}`)
                    : `/projects/${project.id}`
                )
              }
            >
              {project.icon ? (
                <span className="text-base leading-none">{project.icon}</span>
              ) : (
                <ListTodo className="text-muted-foreground" />
              )}
              <span>{project.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Documents */}
        <CommandGroup heading={t("groups.documents")}>
          {documents.map((doc) => {
            const DocIcon = getDocumentIcon(
              doc.document_type,
              doc.file_content_type,
              doc.original_filename
            );
            const docIconColor = getDocumentIconColor(
              doc.document_type,
              doc.file_content_type,
              doc.original_filename
            );
            return (
              <CommandItem
                key={`document-${doc.id}`}
                value={`document-${doc.id}-${doc.title}`}
                keywords={[doc.initiative?.name ?? "", ...(doc.tags?.map((tag) => tag.name) ?? [])]}
                onSelect={() =>
                  handleSelect(
                    activeGuildId
                      ? guildPath(activeGuildId, `/documents/${doc.id}`)
                      : `/documents/${doc.id}`
                  )
                }
              >
                <DocIcon className={docIconColor} />
                <span>{doc.title}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* Queues */}
        <CommandGroup heading={t("groups.queues")}>
          {queues.map((queue) => (
            <CommandItem
              key={`queue-${queue.id}`}
              value={`queue-${queue.id}-${queue.name}`}
              keywords={[queue.description ?? ""]}
              onSelect={() =>
                handleSelect(
                  activeGuildId
                    ? guildPath(activeGuildId, `/queues/${queue.id}`)
                    : `/queues/${queue.id}`
                )
              }
            >
              <GalleryHorizontalEnd className="text-muted-foreground" />
              <span>{queue.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Counter Groups */}
        <CommandGroup heading={t("groups.counterGroups")}>
          {counterGroups.map((group) => (
            <CommandItem
              key={`counter-group-${group.id}`}
              value={`counter-group-${group.id}-${group.name}`}
              keywords={[group.description ?? ""]}
              onSelect={() =>
                handleSelect(
                  activeGuildId
                    ? guildPath(activeGuildId, `/counter-groups/${group.id}`)
                    : `/counter-groups/${group.id}`
                )
              }
            >
              <Gauge className="text-muted-foreground" />
              <span>{group.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Tasks */}
        <CommandGroup heading={t("groups.tasks")}>
          {tasks.map((task) => (
            <CommandItem
              key={`task-${task.id}`}
              value={`task-${task.id}-${task.title}`}
              keywords={[
                task.description ?? "",
                task.project_name ?? "",
                task.initiative_name ?? "",
                ...(task.tags?.map((tag) => tag.name) ?? []),
              ]}
              onSelect={() =>
                handleSelect(
                  task.guild_id
                    ? guildPath(task.guild_id, `/tasks/${task.id}`)
                    : `/tasks/${task.id}`
                )
              }
            >
              <CheckSquare className="text-muted-foreground" />
              <span>{task.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
