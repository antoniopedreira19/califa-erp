import { Skeleton } from "@/components/ui/skeleton";

export default function ContratoLoading() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Skeleton className="h-8 w-20" />
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
