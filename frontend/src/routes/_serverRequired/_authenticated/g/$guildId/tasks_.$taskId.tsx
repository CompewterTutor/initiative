import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import {
  getListCommentsApiV1CommentsGetQueryKey,
  listCommentsApiV1CommentsGet,
} from "@/api/generated/comments/comments";
import {
  getReadProjectApiV1ProjectsProjectIdGetQueryKey,
  readProjectApiV1ProjectsProjectIdGet,
} from "@/api/generated/projects/projects";
import {
  getListTaskStatusesApiV1ProjectsProjectIdTaskStatusesGetQueryKey,
  listTaskStatusesApiV1ProjectsProjectIdTaskStatusesGet,
} from "@/api/generated/task-statuses/task-statuses";
import {
  getReadTaskApiV1TasksTaskIdGetQueryKey,
  readTaskApiV1TasksTaskIdGet,
} from "@/api/generated/tasks/tasks";
import {
  getListUsersApiV1UsersGetQueryKey,
  listUsersApiV1UsersGet,
} from "@/api/generated/users/users";

export const Route = createFileRoute("/_serverRequired/_authenticated/g/$guildId/tasks_/$taskId")({
  loader: async ({ context, params }) => {
    const taskId = Number(params.taskId);
    const { queryClient } = context;

    // Prefetch in background - don't block navigation on failure
    try {
      // Prefetch task, users, and comments in parallel
      const [task] = await Promise.all([
        queryClient.ensureQueryData({
          queryKey: getReadTaskApiV1TasksTaskIdGetQueryKey(taskId),
          queryFn: () => readTaskApiV1TasksTaskIdGet(taskId),
          staleTime: 30_000,
        }),
        queryClient.ensureQueryData({
          queryKey: getListUsersApiV1UsersGetQueryKey(),
          queryFn: () => listUsersApiV1UsersGet(),
          staleTime: 60_000,
        }),
        queryClient.ensureQueryData({
          queryKey: getListCommentsApiV1CommentsGetQueryKey({ task_id: taskId }),
          queryFn: () => listCommentsApiV1CommentsGet({ task_id: taskId }),
          staleTime: 30_000,
        }),
      ]);

      // Prefetch project-related data if we have task
      const taskData = task as unknown as { project_id?: number } | undefined;
      if (taskData?.project_id) {
        await Promise.all([
          queryClient.ensureQueryData({
            queryKey: getReadProjectApiV1ProjectsProjectIdGetQueryKey(taskData.project_id),
            queryFn: () => readProjectApiV1ProjectsProjectIdGet(taskData.project_id!),
            staleTime: 30_000,
          }),
          queryClient.ensureQueryData({
            queryKey: getListTaskStatusesApiV1ProjectsProjectIdTaskStatusesGetQueryKey(
              taskData.project_id
            ),
            queryFn: () =>
              listTaskStatusesApiV1ProjectsProjectIdTaskStatusesGet(taskData.project_id!),
            staleTime: 60_000,
          }),
        ]);
      }
    } catch {
      // Silently fail - component will fetch its own data
    }
  },
  component: lazyRouteComponent(() =>
    import("@/pages/TaskEditPage").then((m) => ({ default: m.TaskEditPage }))
  ),
});
