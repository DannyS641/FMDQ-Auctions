import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, ChevronLeft, Upload } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageSpinner } from "@/components/ui/Spinner";
import { getItem, createItem, updateItem, archiveItem } from "@/api/items";
import { getCategories } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { formatDateTimeLocal } from "@/lib/formatters";
import { ApiError } from "@/lib/api-client";

const schema = z.object({
  title: z.string().min(2, "Title is required"),
  category: z.string().min(1, "Category is required"),
  lot: z.string().min(1, "Lot number is required"),
  sku: z.string().min(1, "SKU is required"),
  condition: z.string().min(1, "Condition is required"),
  location: z.string().min(1, "Location is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  startBid: z.number({ invalid_type_error: "Required" }).positive("Must be positive"),
  reserve: z.number({ invalid_type_error: "Required" }).nonnegative("Must be 0 or positive").optional(),
  increment: z.number({ invalid_type_error: "Required" }).positive("Must be positive"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
}).refine((d) => new Date(d.endTime) > new Date(d.startTime), {
  path: ["endTime"],
  message: "End time must be after start time",
});

type FormData = z.infer<typeof schema>;

export default function AdminItemForm() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const { data: item, isLoading: itemLoading } = useQuery({
    queryKey: queryKeys.items.detail(id ?? ""),
    queryFn: () => getItem(id!, true),
    enabled: isEdit,
  });

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.items.categories(),
    queryFn: getCategories,
    staleTime: 5 * 60_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // Populate form when editing
  useEffect(() => {
    if (item) {
      reset({
        title: item.title,
        category: item.category,
        lot: item.lot,
        sku: item.sku,
        condition: item.condition,
        location: item.location,
        description: item.description,
        startBid: item.startBid,
        reserve: item.reserve,
        increment: item.increment,
        startTime: formatDateTimeLocal(item.startTime),
        endTime: formatDateTimeLocal(item.endTime),
      });
    }
  }, [item, reset]);

  const buildFormData = (data: FormData): FormData => {
    const fd = new globalThis.FormData();
    (Object.entries(data) as [string, unknown][]).forEach(([k, v]) => {
      if (v != null && v !== "") fd.append(k, String(v));
    });
    imageFiles.forEach((f) => fd.append("images", f));
    docFiles.forEach((f) => fd.append("documents", f));
    return fd as unknown as FormData;
  };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (data: FormData) => {
      const fd = buildFormData(data);
      return isEdit
        ? updateItem(id!, fd as unknown as globalThis.FormData)
        : createItem(fd as unknown as globalThis.FormData);
    },
    onSuccess: (saved) => {
      toast.success(isEdit ? "Item updated." : "Item created.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.all() });
      navigate(`/bidding/${saved.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Save failed. Please try again.");
    },
  });

  const { mutate: archive, isPending: archiving } = useMutation({
    mutationFn: () => archiveItem(id!),
    onSuccess: () => {
      toast.success("Item archived.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.all() });
      navigate("/admin/items");
    },
    onError: () => toast.error("Could not archive item."),
  });

  if (isEdit && itemLoading) return <PageShell><PageSpinner /></PageShell>;

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin/items"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate hover:text-neon"
            >
              <ChevronLeft size={14} />
              Items
            </Link>
            <SectionHeader title={isEdit ? "Edit item" : "New auction item"} />
          </div>
          {isEdit && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowArchiveConfirm(true)}
            >
              <Trash2 size={14} />
              Archive
            </Button>
          )}
        </div>

        <form onSubmit={handleSubmit((d) => save(d))} className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-slate">
              Basic information
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  id="title"
                  label="Title"
                  placeholder="Item title"
                  error={errors.title?.message}
                  {...register("title")}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-slate">
                  Category
                </label>
                <select
                  className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-neon"
                  {...register("category")}
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
              </div>
              <Input id="lot" label="Lot number" placeholder="e.g. LOT-001" error={errors.lot?.message} {...register("lot")} />
              <Input id="sku" label="SKU" placeholder="e.g. FMD-2024-001" error={errors.sku?.message} {...register("sku")} />
              <Input id="condition" label="Condition" placeholder="e.g. New, Used" error={errors.condition?.message} {...register("condition")} />
              <Input id="location" label="Location" placeholder="e.g. Lagos, Nigeria" error={errors.location?.message} {...register("location")} />
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-slate">
                  Description
                </label>
                <textarea
                  id="description"
                  rows={5}
                  placeholder="Detailed item description…"
                  className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-slate/60 focus:outline-none focus:ring-2 focus:ring-neon"
                  {...register("description")}
                />
                {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-slate">
              Pricing &amp; timing
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                id="startBid"
                type="number"
                label="Starting bid (NGN)"
                placeholder="0"
                error={errors.startBid?.message}
                {...register("startBid", { valueAsNumber: true })}
              />
              <Input
                id="reserve"
                type="number"
                label="Reserve price (NGN, optional)"
                placeholder="Leave blank for no reserve"
                error={errors.reserve?.message}
                {...register("reserve", { valueAsNumber: true, setValueAs: (v) => v === "" ? undefined : Number(v) })}
              />
              <Input
                id="increment"
                type="number"
                label="Bid increment (NGN)"
                placeholder="0"
                error={errors.increment?.message}
                {...register("increment", { valueAsNumber: true })}
              />
              <Input
                id="startTime"
                type="datetime-local"
                label="Start time"
                error={errors.startTime?.message}
                {...register("startTime")}
              />
              <Input
                id="endTime"
                type="datetime-local"
                label="End time"
                error={errors.endTime?.message}
                {...register("endTime")}
              />
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-slate">
              Images &amp; documents
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Images */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate">
                  Images
                </p>
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink/10 bg-ash p-6 text-slate transition hover:border-neon/30 hover:bg-[#eef3ff] hover:text-neon"
                >
                  <Upload size={20} />
                  <span className="text-xs font-semibold">
                    {imageFiles.length > 0
                      ? `${imageFiles.length} file(s) selected`
                      : "Click to upload images"}
                  </span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))}
                />
                {isEdit && item && item.images.length > 0 && (
                  <p className="mt-2 text-xs text-slate">
                    {item.images.length} existing image(s). Upload new files to replace.
                  </p>
                )}
              </div>

              {/* Documents */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate">
                  Documents
                </p>
                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink/10 bg-ash p-6 text-slate transition hover:border-neon/30 hover:bg-[#eef3ff] hover:text-neon"
                >
                  <Upload size={20} />
                  <span className="text-xs font-semibold">
                    {docFiles.length > 0
                      ? `${docFiles.length} file(s) selected`
                      : "Click to upload documents"}
                  </span>
                </button>
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xlsx,.csv"
                  multiple
                  className="hidden"
                  onChange={(e) => setDocFiles(Array.from(e.target.files ?? []))}
                />
                {isEdit && item && item.documents.length > 0 && (
                  <p className="mt-2 text-xs text-slate">
                    {item.documents.length} existing document(s). Upload new files to replace.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            <Link to={isEdit ? `/bidding/${id}` : "/admin/items"}>
              <Button type="button" variant="secondary">Cancel</Button>
            </Link>
            <Button type="submit" isLoading={saving} disabled={isEdit && !isDirty && imageFiles.length === 0 && docFiles.length === 0}>
              {isEdit ? "Save changes" : "Create item"}
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
        title="Archive this item?"
        description="The item will be hidden from the auction desk. You can restore it from the admin panel."
        confirmLabel="Archive"
        destructive
        onConfirm={() => archive()}
        isLoading={archiving}
      />
    </PageShell>
  );
}
