import { HttpResponse, http } from "msw";

export const tagHandlers = [
  http.get("/api/v1/tags/", () => {
    return HttpResponse.json([]);
  }),
];
