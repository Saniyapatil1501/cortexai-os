import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Github, Chrome, ShieldAlert, KeyRound } from "lucide-react";
import { Logo } from "@/components/cortex/Logo";
import { AmbientBackground } from "@/components/cortex/AmbientBackground";
import { useState, useEffect } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { useCortexAuth } from "@/hooks/useCortexAuth";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";

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
  
  const signInContext = useSignIn();
  const signUpContext = useSignUp();

  const { user, isLoading } = useCortexAuth();

  useEffect(() => {
    if (!isLoading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [isLoading, user, navigate]);

  const [mode, setMode] = useState<"signin" | "signup" | "verify">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Clear errors when toggling modes
  useEffect(() => {
    setError("");
  }, [mode]);

  const handleBack = () => {
    if (mode !== "signin") {
      setMode("signin");
    } else {
      window.history.back();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!signInContext.isLoaded || !signUpContext.isLoaded) return;
    setLoading(true);

    try {
      if (mode === "signin") {
        const result = await signInContext.signIn.create({
          identifier: email,
          password,
        });
        if (result.status === "complete") {
          await signInContext.setActive({ session: result.createdSessionId });
          navigate({ to: "/dashboard" });
        } else {
          setError(`Sign in status: ${result.status}`);
        }
      } else if (mode === "signup") {
        await signUpContext.signUp.create({
          emailAddress: email,
          password,
        });
        await signUpContext.signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });
        setMode("verify");
      } else if (mode === "verify") {
        const result = await signUpContext.signUp.attemptEmailAddressVerification({
          code,
        });
        if (result.status === "complete") {
          await signUpContext.setActive({ session: result.createdSessionId });
          navigate({ to: "/dashboard" });
        } else {
          setError(`Verification status: ${result.status}`);
        }
      }
    } catch (err: any) {
      setError(err.errors?.[0]?.message || err.message || "An authentication error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "oauth_google" | "oauth_github") => {
    setError("");
    
    if (!signInContext.isLoaded) return;
    setLoading(true);

    try {
      const strategy = provider === "oauth_google" ? "oauth_google" : "oauth_github";
      await signInContext.signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: window.location.origin + "/sso-callback",
        redirectUrlComplete: window.location.origin + "/dashboard",
      });
    } catch (err: any) {
      setError(err.message || "Failed to initiate social login");
      setLoading(false);
    }
  };

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
        <AmbientBackground density={30} />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-md p-8 rounded-2xl border border-border/60 bg-surface-1/40 backdrop-blur-xl shadow-2xl surface-glow"
        >
          <div className="flex justify-between items-center mb-6">
            <button
              onClick={handleBack}
              className="group inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition cursor-pointer select-none"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              {mode !== "signin" ? "Back to sign in" : "Back"}
            </button>
            <div className="lg:hidden">
              <Logo showWord={false} />
            </div>
          </div>
          


          {mode === "signin" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">Sign in to enter your workspace.</p>
            </>
          )}
          {mode === "signup" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">Begin orchestrating your focus today.</p>
            </>
          )}
          {mode === "verify" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">Enter the verification code sent to your email.</p>
            </>
          )}

          {error && (
            <div className="mt-4 flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-3">
            {mode !== "verify" ? (
              <>
                <Field 
                  label="Email" 
                  type="email" 
                  placeholder="you@cortex.ai" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Field 
                  label="Password" 
                  type="password" 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {mode === "signin" && (
                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 text-muted-foreground select-none">
                      <input type="checkbox" className="rounded border-border bg-surface-1" /> Remember me
                    </label>
                    <a className="text-foreground/80 hover:text-foreground" href="#">
                      Forgot password?
                    </a>
                  </div>
                )}
              </>
            ) : (
              <Field 
                label="Verification Code" 
                type="text" 
                placeholder="123456" 
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            )}

            <button
              type="submit"
              disabled={loading}
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Please wait..." : mode === "signin" ? "Enter workspace" : mode === "signup" ? "Get started" : "Verify code"}
              {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>

          {mode !== "verify" && (
            <>
              <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> or continue with <div className="h-px flex-1 bg-border" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SocialBtn icon={<Chrome className="h-4 w-4" />} onClick={() => handleSocialLogin("oauth_google")} disabled={loading}>Google</SocialBtn>
                <SocialBtn icon={<Github className="h-4 w-4" />} onClick={() => handleSocialLogin("oauth_github")} disabled={loading}>GitHub</SocialBtn>
              </div>
            </>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground select-none">
            {mode === "signin" ? (
              <>
                New to CortexAI?{" "}
                <button onClick={() => setMode("signup")} className="text-foreground hover:underline font-medium focus:outline-none">
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => setMode("signin")} className="text-foreground hover:underline font-medium focus:outline-none">
                  Sign in
                </button>
              </>
            )}
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

function SocialBtn({ icon, children, onClick, disabled }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface-1/60 px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50 cursor-pointer"
    >
      {icon} {children}
    </button>
  );
}

