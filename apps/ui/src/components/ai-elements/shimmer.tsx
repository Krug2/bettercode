import { cn } from "@/lib/utils"
import { memo } from "react"

export interface TextShimmerProps {
  children: string
  as?: "div" | "p" | "span"
  className?: string
  /** Accepted for existing callers; status text no longer animates. */
  duration?: number
  spread?: number
  /** Override the status text color. */
  color?: string
}

// A turn can run for hours in several panes. Animating background-position
// repainted each label every frame, including for users requesting less motion.
// Keep the existing component contract while displaying a steady status label.
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  color,
}: TextShimmerProps) => {
  return (
    <Component
      className={cn("inline-block text-muted-foreground", className)}
      style={color ? { color } : undefined}
    >
      {children}
    </Component>
  )
}

export const Shimmer = memo(ShimmerComponent)
