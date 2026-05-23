import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Github, Chrome } from "lucide-react";
import { Logo } from "@/components/cortex/Logo";
import { AmbientBackground } from "@/components/cortex/AmbientBackground";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — CortexAI" },
      { name: "description", content: "Sign in to your CortexAI productivity workspace." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  return (
    <div className="relative min-h-screen grid lg:grid-cols-2 bg-background text-foreground">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-10 border-r border-border overflow-hidden">
        <AmbientBackground density={80} />
        <div className="relative z-10">
          <Logo showWord />
        </div>
        <div className="relative z-10 max-w-md">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-4xl font-semibold tracking-tight text-gradient leading-tight"
          >
            The operating system for focused minds.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-4 text-sm text-muted-foreground leading-relaxed"
          >
            CortexAI orchestrates your focus sessions, study patterns, and coding flow into a single calm,
            intelligent workspace.
          </motion.p>
        </div>
        <div className="relative z-10 text-xs text-muted-foreground">
          © {new Date().getFullYear()} CortexAI · v1.0
        </div>
      </div>

      {/* Right form */}
      <div className="relative flex items-center justify-center p-6 sm:p-10">
        <AmbientBackground density={30} className="lg:hidden" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-sm"
        >
          <div className="lg:hidden mb-8">
            <Logo showWord />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Sign in to enter your workspace.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ to: "/dashboard" });
            }}
            className="mt-8 space-y-3"
          >
            <Field label="Email" type="email" placeholder="you@cortex.ai" />
            <Field label="Password" type="password" placeholder="••••••••" />
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-muted-foreground">
                <input type="checkbox" className="rounded border-border bg-surface-1" /> Remember me
              </label>
              <a className="text-foreground/80 hover:text-foreground" href="#">
                Forgot password?
              </a>
            </div>
            <button
              type="submit"
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Enter workspace
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or continue with <div className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <SocialBtn icon={<Chrome className="h-4 w-4" />}>Google</SocialBtn>
            <SocialBtn icon={<Github className="h-4 w-4" />}>GitHub</SocialBtn>
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            New to CortexAI? <a className="text-foreground hover:underline">Create an account</a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5">{label}</span>
      <input
        {...rest}
        className="w-full rounded-md border border-border bg-surface-1/60 px-3 py-2.5 text-sm outline-none transition focus:border-foreground/40 focus:bg-surface-1"
      />
    </label>
  );
}

function SocialBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface-1/60 px-3 py-2 text-sm hover:bg-surface-2"
    >
      {icon} {children}
    </button>
  );
}
