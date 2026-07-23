"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "light" | "dark" | "system";
const ORDER: Theme[] = ["light", "dark", "system"];

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Cycles light -> dark -> system; persisted in localStorage ("theme"). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    setTheme(stored && ORDER.includes(stored) ? stored : "system");
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  if (!theme) {
    // Placeholder with the same footprint until the stored value is known.
    return <span className={className} aria-hidden />;
  }

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  return (
    <button
      type="button"
      title={`Theme: ${theme} — click for ${next}`}
      aria-label={`Theme: ${theme} — click for ${next}`}
      className={className}
      onClick={() => {
        localStorage.setItem("theme", next);
        setTheme(next);
        apply(next);
      }}
    >
      <Icon className="h-4 w-4" />
      <span className="capitalize">{theme}</span>
    </button>
  );
}
