interface LogoProps {
  size?: number;
  className?: string;
  showWord?: boolean;
}

export function Logo({ size = 28, className = "", showWord = false }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="CortexAI"
      >
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="8"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        <path
          d="M10 11.5C10 10.6716 10.6716 10 11.5 10H20.5C21.3284 10 22 10.6716 22 11.5V20.5C22 21.3284 21.3284 22 20.5 22H11.5C10.6716 22 10 21.3284 10 20.5V11.5Z"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <circle cx="13" cy="14" r="1" fill="currentColor" />
        <circle cx="19" cy="14" r="1" fill="currentColor" />
        <path d="M13 18.5H19" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M16 6V10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M16 22V26" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M6 16H10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M22 16H26" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
      {showWord && (
        <span className="text-[15px] font-semibold tracking-tight">
          Cortex<span className="text-muted-foreground">AI</span>
        </span>
      )}
    </div>
  );
}
