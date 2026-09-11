import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Github, Chrome, ShieldAlert, KeyRound, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/cortex/Logo";
import { AmbientBackground } from "@/components/cortex/AmbientBackground";
import { WindowControls } from "@/components/cortex/WindowControls";
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

  const { sessionState } = useCortexAuth();

  useEffect(() => {
    if (sessionState === "authenticated") {
      navigate({ to: "/dashboard" });
    }
  }, [sessionState, navigate]);

  const [mode, setMode] = useState<"signin" | "signup" | "verify" | "forgot" | "forgot_verify" | "mfa">("signin");
  const [supportedFactors, setSupportedFactors] = useState<any[]>([]);
  const [selectedFactor, setSelectedFactor] = useState<any | null>(null);
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Clear notifications when toggling modes
  useEffect(() => {
    setError("");
  }, [mode]);

  if (sessionState === "booting") {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-background text-foreground select-none">
        <AmbientBackground density={30} />
        <div className="text-center flex flex-col items-center gap-4">
          <Logo size={48} />
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          <p className="text-xs text-muted-foreground tracking-wide mt-2">Starting CortexAI...</p>
        </div>
      </div>
    );
  }

  if (sessionState === "authenticating") {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-background text-foreground">
        <AmbientBackground density={30} />
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Syncing workspace session...</p>
        </div>
      </div>
    );
  }

  if (sessionState === "signing_out") {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-background text-foreground">
        <AmbientBackground density={30} />
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Signing out...</p>
        </div>
      </div>
    );
  }

  const handleBack = () => {
    setError("");
    setSuccessMessage("");
    if (mode === "mfa" && showMethodSelector) {
      setShowMethodSelector(false);
    } else if (mode === "forgot_verify") {
      setMode("forgot");
    } else if (mode === "forgot" || mode === "signup" || mode === "verify" || mode === "mfa") {
      setMode("signin");
    } else {
      window.history.back();
    }
  };

  const formatClerkError = (err: any): string => {
    if (err.errors && err.errors.length > 0) {
      const errorObj = err.errors[0];
      const code = errorObj.code;
      const message = errorObj.message || "";
      
      if (code === "form_password_incorrect" || message.toLowerCase().includes("password") || message.toLowerCase().includes("incorrect")) {
        return "Password is incorrect. Try again, or use another method.";
      }
      if (code === "form_identifier_not_found" || message.toLowerCase().includes("user") || message.toLowerCase().includes("identifier") || message.toLowerCase().includes("email")) {
        return "No account was found with this email.";
      }
      return errorObj.message || "An authentication error occurred. Please try again.";
    }
    return err.message || "An authentication error occurred. Please try again.";
  };

  const formatResetError = (err: any): string => {
    if (err.errors && err.errors.length > 0) {
      const errorObj = err.errors[0];
      const code = errorObj.code;
      const message = errorObj.message || "";
      
      if (code === "form_identifier_not_found" || message.toLowerCase().includes("user") || message.toLowerCase().includes("email")) {
        return "No account was found with this email.";
      }
      if (code === "form_code_incorrect" || message.toLowerCase().includes("code") || message.toLowerCase().includes("incorrect")) {
        return "Invalid or expired code. Please try again.";
      }
      if (code === "form_code_expired" || message.toLowerCase().includes("expired")) {
        return "Code expired. Request a new code.";
      }
      return errorObj.message || "Unable to reset password right now. Please try again.";
    }
    return err.message || "Unable to reset password right now. Please try again.";
  };

  const handleResendResetCode = async () => {
    setError("");
    setLoading(true);
    try {
      const firstFactor = signInContext.signIn.supportedFirstFactors?.find(
        (f: any) => f.strategy === "reset_password_email_code"
      );
      if (!firstFactor || !("emailAddressId" in firstFactor)) {
        throw new Error("Reset password email code strategy is not available for this account.");
      }
      await signInContext.signIn.prepareFirstFactor({
        strategy: "reset_password_email_code",
        emailAddressId: firstFactor.emailAddressId,
      });
      setSuccessMessage("Verification code resent successfully!");
    } catch (err: any) {
      setError(formatResetError(err));
    } finally {
      setLoading(false);
    }
  };

  const selectAndPrepareFactor = async (factor: any, signInObj: any) => {
    setSelectedFactor(factor);
    setError("");
    if (factor.strategy === "email_code") {
      await signInObj.prepareSecondFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId,
      });
    } else if (factor.strategy === "phone_code") {
      await signInObj.prepareSecondFactor({
        strategy: "phone_code",
        phoneNumberId: factor.phoneNumberId,
      });
    }
  };

  const handleResendMFACode = async () => {
    if (!selectedFactor) return;
    setError("");
    setLoading(true);
    try {
      await selectAndPrepareFactor(selectedFactor, signInContext.signIn);
      setSuccessMessage("Verification code resent successfully!");
    } catch (err: any) {
      setError("Unable to send a new verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const getFactorLabel = (factor: any) => {
    switch (factor.strategy) {
      case "totp":
        return "Authenticator App (TOTP)";
      case "phone_code":
        return `SMS to ${factor.safeIdentifier}`;
      case "email_code":
        return `Email to ${factor.safeIdentifier}`;
      case "backup_code":
        return "Backup Verification Code";
      default:
        return `Verification via ${factor.strategy}`;
    }
  };

  const handleSelectMethod = async (factor: any) => {
    setShowMethodSelector(false);
    setLoading(true);
    try {
      await selectAndPrepareFactor(factor, signInContext.signIn);
    } catch (err: any) {
      setError(formatClerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!signInContext.isLoaded || !signUpContext.isLoaded) return;
    setLoading(true);

    try {
      if (mode === "signin") {
        setSuccessMessage(""); // Clear success message on login attempt
        const result = await signInContext.signIn.create({
          strategy: "password",
          identifier: email,
          password,
        });
        if (result.status === "complete") {
          await signInContext.setActive({ session: result.createdSessionId });
          navigate({ to: "/dashboard" });
        } else if (result.status === "needs_second_factor") {
          const factors = result.supportedSecondFactors || [];
          setSupportedFactors(factors);
          if (factors.length === 0) {
            setError("No usable second factor is configured for this account.");
            return;
          }
          setCode("");
          setMode("mfa");
          try {
            await selectAndPrepareFactor(factors[0], result);
          } catch (prepErr: any) {
            setError(formatClerkError(prepErr));
          }
        } else {
          setError(`Sign in status: ${result.status}`);
        }
      } else if (mode === "signup") {
        const nameParts = name.trim().split(" ");
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(" ") || "";

        await signUpContext.signUp.create({
          emailAddress: email,
          password,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
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
      } else if (mode === "mfa") {
        if (!code) {
          setError("Please enter the verification code.");
          setLoading(false);
          return;
        }
        if (!selectedFactor) {
          setError("No verification method selected.");
          setLoading(false);
          return;
        }
        
        let attemptParams: any;
        if (selectedFactor.strategy === "totp") {
          attemptParams = { strategy: "totp", code };
        } else if (selectedFactor.strategy === "backup_code") {
          attemptParams = { strategy: "backup_code", code };
        } else if (selectedFactor.strategy === "email_code") {
          attemptParams = { strategy: "email_code", code };
        } else if (selectedFactor.strategy === "phone_code") {
          attemptParams = { strategy: "phone_code", code };
        } else {
          setError(`Unsupported verification method: ${selectedFactor.strategy}`);
          setLoading(false);
          return;
        }
        
        const result = await signInContext.signIn.attemptSecondFactor(attemptParams);
        if (result.status === "complete") {
          await signInContext.setActive({ session: result.createdSessionId });
          navigate({ to: "/dashboard" });
        } else {
          setError(`Verification status: ${result.status}`);
        }
      } else if (mode === "forgot") {
        if (!email) {
          setError("Please enter a valid email address.");
          setLoading(false);
          return;
        }
        const result = await signInContext.signIn.create({
          identifier: email,
        });
        const firstFactor = result.supportedFirstFactors?.find(
          (f: any) => f.strategy === "reset_password_email_code"
        );
        if (!firstFactor || !("emailAddressId" in firstFactor)) {
          throw new Error("Reset password email code strategy is not available for this account.");
        }
        await result.prepareFirstFactor({
          strategy: "reset_password_email_code",
          emailAddressId: firstFactor.emailAddressId,
        });
        setMode("forgot_verify");
      } else if (mode === "forgot_verify") {
        if (!code) {
          setError("Invalid or expired code. Please try again.");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        const result = await signInContext.signIn.attemptFirstFactor({
          strategy: "reset_password_email_code",
          code,
          password,
        });
        if (result.status === "complete") {
          setMode("signin");
          setPassword("");
          setConfirmPassword("");
          setCode("");
          setSuccessMessage("Password successfully reset. Please sign in with your new password.");
        } else {
          setError(`Reset password status: ${result.status}`);
        }
      }
    } catch (err: any) {
      const isSessionAlreadyExists = err.errors?.some(
        (e: any) => e.code === "session_already_exists"
      );
      if (isSessionAlreadyExists) {
        console.log("[CortexAuth] Clerk indicates session already exists. Awaiting synchronization.");
        return;
      }
      if (mode === "forgot" || mode === "forgot_verify") {
        setError(formatResetError(err));
      } else {
        setError(formatClerkError(err));
      }
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
        ...(provider === "oauth_google"
          ? {
              oidcPrompt: "select_account",
            }
          : {}),
      });
    } catch (err: any) {
      setError(err.message || "Failed to initiate social login");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen grid lg:grid-cols-2 bg-background text-foreground drag-region">
      <WindowControls className="absolute top-4 right-4 z-50 no-drag-region" />
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-10 border-r border-border overflow-hidden drag-region">
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
            CortexAI orchestrates your focus sessions, study patterns, and coding flow into a single
            calm, intelligent workspace.
          </motion.p>
        </div>
        <div className="relative z-10 text-xs text-muted-foreground">
          © {new Date().getFullYear()} CortexAI · v1.0
        </div>
      </div>

      {/* Right form */}
      <div className="relative flex items-center justify-center p-6 sm:p-10 no-drag-region">
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
              {mode === "forgot_verify"
                ? "Back"
                : mode !== "signin"
                  ? "Back to sign in"
                  : "Back"}
            </button>
            <div className="lg:hidden">
              <Logo showWord={false} />
            </div>
          </div>

          {mode === "signin" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Sign in to enter your workspace.
              </p>
            </>
          )}
          {mode === "signup" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Begin orchestrating your focus today.
              </p>
            </>
          )}
          {mode === "verify" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Enter the verification code sent to your email.
              </p>
            </>
          )}
          {mode === "forgot" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Enter your email address to receive a password reset code.
              </p>
            </>
          )}
          {mode === "forgot_verify" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Create new password</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Enter the verification code sent to your email and choose your new password.
              </p>
            </>
          )}
          {mode === "mfa" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Additional verification required</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Your account requires one more verification step to complete sign-in.
              </p>
            </>
          )}

          {error && (
            <div className="mt-4 flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {successMessage && (
            <div className="mt-4 flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-400">
              <KeyRound className="h-4 w-4 shrink-0 text-emerald-400" />
              <div>{successMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-3">
            {mode === "signin" && (
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
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-2 text-muted-foreground select-none">
                    <input type="checkbox" className="rounded border-border bg-surface-1" />{" "}
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-foreground/80 hover:text-foreground bg-transparent border-0 cursor-pointer outline-none hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              </>
            )}

            {mode === "signup" && (
              <>
                <Field
                  label="Name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
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
              </>
            )}

            {mode === "verify" && (
              <Field
                label="Verification Code"
                type="text"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            )}

            {mode === "forgot" && (
              <Field
                label="Email"
                type="email"
                placeholder="you@cortex.ai"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}

            {mode === "forgot_verify" && (
              <>
                <Field
                  label="Verification Code"
                  type="text"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <Field
                  label="New Password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Field
                  label="Confirm Password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <div className="flex justify-between items-center text-xs text-muted-foreground mt-2 select-none">
                  <button
                    type="button"
                    onClick={handleResendResetCode}
                    disabled={loading}
                    className="hover:text-foreground bg-transparent border-0 cursor-pointer outline-none hover:underline"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    disabled={loading}
                    className="hover:text-foreground bg-transparent border-0 cursor-pointer outline-none hover:underline"
                  >
                    Change email
                  </button>
                </div>
              </>
            )}

            {mode === "mfa" && (
              <>
                {showMethodSelector ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">
                      Select your preferred verification method:
                    </p>
                    {supportedFactors.map((factor, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => handleSelectMethod(factor)}
                        className="w-full text-left flex items-center justify-between rounded-md border border-border bg-surface-1/60 px-3 py-2.5 text-sm hover:bg-surface-2 transition cursor-pointer"
                      >
                        <span>{getFactorLabel(factor)}</span>
                        <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowMethodSelector(false)}
                      className="w-full text-center mt-3 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <Field
                      label="Verification Code"
                      type="text"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                    />
                    <div className="flex justify-between items-center text-xs text-muted-foreground mt-2 select-none">
                      {selectedFactor && (selectedFactor.strategy === "email_code" || selectedFactor.strategy === "phone_code") ? (
                        <button
                          type="button"
                          onClick={handleResendMFACode}
                          disabled={loading}
                          className="hover:text-foreground bg-transparent border-0 cursor-pointer outline-none hover:underline"
                        >
                          Resend code
                        </button>
                      ) : (
                        <div />
                      )}
                      {supportedFactors.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setShowMethodSelector(true);
                          }}
                          disabled={loading}
                          className="hover:text-foreground bg-transparent border-0 cursor-pointer outline-none hover:underline"
                        >
                          Change verification method
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {(mode !== "mfa" || !showMethodSelector) && (
              <button
                type="submit"
                disabled={loading}
                className="group mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {loading
                  ? "Please wait..."
                  : mode === "signin"
                    ? "Enter workspace"
                    : mode === "signup"
                      ? "Get started"
                      : mode === "forgot"
                        ? "Send reset code"
                        : mode === "forgot_verify"
                          ? "Reset Password"
                          : mode === "mfa"
                            ? "Verify and continue"
                            : "Verify code"}
                {!loading && (
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            )}
          </form>

          {mode !== "verify" && mode !== "forgot" && mode !== "forgot_verify" && mode !== "mfa" && (
            <>
              <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> or continue with{" "}
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SocialBtn
                  icon={<Chrome className="h-4 w-4" />}
                  onClick={() => handleSocialLogin("oauth_google")}
                  disabled={loading}
                >
                  Google
                </SocialBtn>
                <SocialBtn
                  icon={<Github className="h-4 w-4" />}
                  onClick={() => handleSocialLogin("oauth_github")}
                  disabled={loading}
                >
                  GitHub
                </SocialBtn>
              </div>
            </>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground select-none">
            {mode === "signin" ? (
              <>
                New to CortexAI?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="text-foreground hover:underline font-medium focus:outline-none"
                >
                  Create an account
                </button>
              </>
            ) : (
              (mode === "signup" || mode === "forgot" || mode === "forgot_verify") && (
                <>
                  Already have an account?{" "}
                  <button
                    onClick={() => setMode("signin")}
                    className="text-foreground hover:underline font-medium focus:outline-none"
                  >
                    Sign in
                  </button>
                </>
              )
            )}
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5">{label}</span>
      <div className="relative">
        <input
          {...rest}
          type={isPassword ? (showPassword ? "text" : "password") : type}
          className={`w-full rounded-md border border-border bg-surface-1/60 py-2.5 text-sm outline-none transition focus:border-foreground/40 focus:bg-surface-1 ${
            isPassword ? "pl-3 pr-10" : "px-3"
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition outline-none cursor-pointer select-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4.5 w-4.5" />
            ) : (
              <Eye className="h-4.5 w-4.5" />
            )}
          </button>
        )}
      </div>
    </label>
  );
}

function SocialBtn({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
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
