import { Moon, Sun } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { useThemeStore } from '@/shared/stores/theme.store';

export function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="hover:bg-primary/10"
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-[#00E6A0]" />
      ) : (
        <Moon className="h-5 w-5 text-[#00E6A0]" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
