import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
    const getVisiblePages = () => {
        const items: (number | 'ellipsis')[] = [];

        items.push(1);
        if (totalPages > 1) items.push(2);

        if (currentPage <= 3) {
            if (totalPages >= 3) items.push(3);
            if (totalPages >= 4) items.push(4);
            if (totalPages >= 5) items.push(5);
            return items;
        }

        if (currentPage >= totalPages - 1) {
            if (totalPages > 5) items.push('ellipsis');
            if (totalPages >= 3) items.push(totalPages - 2);
            if (totalPages >= 2) items.push(totalPages - 1);
            if (totalPages > 2) items.push(totalPages);
            return items;
        }

        items.push('ellipsis');
        items.push(currentPage);
        if (currentPage + 1 < totalPages) {
            items.push(currentPage + 1);
        }
        items.push('ellipsis');
        items.push(totalPages);

        return items;
    };

    return (
        <div className="flex items-center justify-center gap-1.5 py-4">
            <button
                className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Página anterior"
            >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>

            {getVisiblePages().map((item, index) => {
                if (item === 'ellipsis') {
                    return (
                        <span
                            key={`ellipsis-${index}`}
                            className="flex items-center justify-center w-8 h-8 text-muted-foreground text-sm font-medium select-none"
                            aria-hidden="true"
                        >
                            ...
                        </span>
                    );
                }

                const isActive = item === currentPage;

                return (
                    <button
                        key={item}
                        className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-md text-[13px] font-medium transition-all',
                            isActive
                                ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        )}
                        onClick={() => onPageChange(item as number)}
                        aria-label={`Ir para página ${item}`}
                        aria-current={isActive ? 'page' : undefined}
                    >
                        {item}
                    </button>
                );
            })}

            <button
                className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="Próxima página"
            >
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
        </div>
    );
}
