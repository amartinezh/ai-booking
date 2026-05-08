export default function PageSkeleton() {
    return (
        <div className="animate-pulse space-y-4 w-full">
            <div className="h-10 bg-zinc-200 dark:bg-zinc-700 rounded-lg w-1/3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-24 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
                ))}
            </div>
            <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            <div className="h-48 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
    );
}
