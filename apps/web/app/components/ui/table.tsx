// Primitivas de tabla minimalistas (Tailwind puro, sin dependencias) que imitan
// la API de shadcn/ui Table: <Table>, <TableHeader>, <TableBody>, <TableRow>,
// <TableHead>, <TableCell>. Tipadas para reutilizarse en cualquier Data Table.
import * as React from 'react';

function cx(...classes: Array<string | undefined | false>): string {
  return classes.filter(Boolean).join(' ');
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className={cx('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cx('bg-zinc-50 dark:bg-zinc-900/60 [&_tr]:border-b border-zinc-200 dark:border-zinc-800', className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cx('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx(
        'border-b border-zinc-100 dark:border-zinc-800/60 transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx(
        'h-11 px-4 text-left align-middle font-semibold text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cx('px-4 py-3 align-middle text-zinc-700 dark:text-zinc-300', className)} {...props} />
  );
}
