import { apiClient } from "@/lib/api-client";
import type { Slide } from "@/types";

export type SlidePlacement = "landing" | "auth";

export const getSlides = async (placement: SlidePlacement = "landing"): Promise<Slide[]> =>
  apiClient<Slide[]>(`/api/slides?placement=${placement}`);

export const uploadSlide = async (file: File, placement: SlidePlacement = "landing"): Promise<Slide> => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("placement", placement);
  return apiClient<Slide>("/api/admin/slides", { method: "POST", body: formData });
};

export const deleteSlide = async (id: string): Promise<{ ok: boolean }> =>
  apiClient(`/api/admin/slides/${id}`, { method: "DELETE" });

export const reorderSlides = async (orderedIds: string[]): Promise<{ ok: boolean }> =>
  apiClient("/api/admin/slides/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });

export const getSiteSettings = async (): Promise<{ slideDurationSeconds: number }> =>
  apiClient("/api/site-settings");

export const updateSiteSettings = async (
  slideDurationSeconds: number,
): Promise<{ ok: boolean; slideDurationSeconds: number }> =>
  apiClient("/api/admin/site-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slideDurationSeconds }),
  });
