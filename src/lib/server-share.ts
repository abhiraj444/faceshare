import { createServerFn } from "@tanstack/react-start";
import { getSql } from "./db";

export interface SharedPortraitPayload {
  id: string;
  title?: string;
  studyId?: string;
  imageData?: string;
  particleData?: string;
  params: Record<string, unknown>;
  yaw: number;
  pitch: number;
  zoom: number;
}

export const saveSharedPortrait = createServerFn({ method: "POST" })
  .validator((data: SharedPortraitPayload) => data)
  .handler(async ({ data }) => {
    try {
      const sql = await getSql();
      const paramsJson = JSON.stringify(data.params);
      await sql`
        INSERT INTO shared_portraits (id, title, study_id, image_data, particle_data, params, yaw, pitch, zoom)
        VALUES (
          ${data.id},
          ${data.title ?? "3D Particle Portrait"},
          ${data.studyId ?? null},
          ${data.imageData ?? null},
          ${data.particleData ?? null},
          ${paramsJson}::jsonb,
          ${data.yaw},
          ${data.pitch},
          ${data.zoom}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          study_id = EXCLUDED.study_id,
          image_data = EXCLUDED.image_data,
          particle_data = EXCLUDED.particle_data,
          params = EXCLUDED.params,
          yaw = EXCLUDED.yaw,
          pitch = EXCLUDED.pitch,
          zoom = EXCLUDED.zoom;
      `;
      return { ok: true, id: data.id };
    } catch (err) {
      console.error("[saveSharedPortrait] DB save failed:", err);
      // Fallback: return ok so client can still use localStorage/hash sharing
      return { ok: false, error: err instanceof Error ? err.message : "Database error" };
    }
  });

export const getSharedPortrait = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    try {
      const sql = await getSql();
      const rows = await sql<any>`
        SELECT id, title, study_id as "studyId", image_data as "imageData", particle_data as "particleData", params, yaw, pitch, zoom
        FROM shared_portraits
        WHERE id = ${id}
        LIMIT 1;
      `;
      if (!rows || rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id,
        title: r.title,
        studyId: r.studyId,
        imageData: r.imageData,
        particleData: r.particleData,
        params: typeof r.params === "string" ? JSON.parse(r.params) : r.params,
        yaw: Number(r.yaw) || 0,
        pitch: Number(r.pitch) || 0.04,
        zoom: Number(r.zoom) || 1.0,
      };
    } catch (err) {
      console.error("[getSharedPortrait] Query failed:", err);
      return null;
    }
  });
