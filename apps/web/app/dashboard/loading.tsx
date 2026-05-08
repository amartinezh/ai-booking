import PageSkeleton from './components/PageSkeleton';

export default function DashboardLoading() {
    return (
        <div className="max-w-7xl mx-auto">
            <div className="animate-pulse h-10 bg-zinc-200 dark:bg-zinc-700 rounded-lg w-64 mb-4" />
            <div className="animate-pulse h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-96 mb-8" />
            <PageSkeleton />
        </div>
    );
}
