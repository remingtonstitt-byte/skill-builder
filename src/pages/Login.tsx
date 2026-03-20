import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Brain } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const authSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type AuthFormValues = z.infer<typeof authSchema>;

export default function LoginPage() {
  const { signIn, signUp, enterAsGuest } = useAuth();
  const [signInPending, setSignInPending] = useState(false);
  const [signUpPending, setSignUpPending] = useState(false);

  const signInForm = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "" },
  });

  const signUpForm = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSignIn = async (values: AuthFormValues) => {
    setSignInPending(true);
    const result = await signIn(values.email, values.password);
    setSignInPending(false);
    if (result.error) {
      const code = result.error.code;
      const msg = result.error.message.toLowerCase();
      if (code === "email_not_confirmed") {
        toast.error(
          "Confirm your email from the link Supabase sent, or turn OFF “Confirm email” in Supabase (Authentication → Providers → Email), remove this user under Users, and sign up again.",
        );
        return;
      }
      if (code === "signup_blocked") {
        toast.error(result.error.message, { duration: 14_000 });
        return;
      }
      if (
        code === "invalid_credentials" ||
        msg.includes("invalid login") ||
        msg.includes("invalid email or password")
      ) {
        toast.error(
          "Wrong email or password — or the account is waiting on email confirmation. In Supabase turn OFF “Confirm email”, delete this user under Authentication → Users, then sign up again.",
          { duration: 12_000 },
        );
        return;
      }
      toast.error(result.error.message);
      return;
    }
  };

  const onSignUp = async (values: AuthFormValues) => {
    setSignUpPending(true);
    const result = await signUp(values.email, values.password);
    setSignUpPending(false);
    if (result.error) {
      if (result.error.code === "signup_blocked") {
        toast.error(result.error.message, { duration: 14_000 });
      } else {
        toast.error(result.error.message);
      }
      return;
    }
    toast.success("You’re in");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-sm w-full border-border/60">
        <CardContent className="pt-8 pb-8 space-y-6">
          <div className="space-y-3 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Brain className="w-4 h-4" />
              Adaptive Stress Tutor
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
            <p className="text-muted-foreground text-sm">
              Sign in to save progress, or try the tutor as a guest (no account).
            </p>
          </div>

          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-4 pt-2">
              <Form {...signInForm}>
                <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-4">
                  <FormField
                    control={signInForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signInForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="current-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-11" size="lg" disabled={signInPending}>
                    {signInPending ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="signup" className="space-y-4 pt-2">
              <Form {...signUpForm}>
                <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4">
                  <FormField
                    control={signUpForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-11" size="lg" disabled={signUpPending}>
                    {signUpPending ? "Creating account…" : "Create account"}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11"
            size="lg"
            onClick={() => enterAsGuest()}
          >
            Try as guest
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Guest mode uses this device only. Core quiz, scan, and chat still work.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
