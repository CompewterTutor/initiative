import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { apiClient } from "@/api/client";
import { LogoIcon } from "@/components/LogoIcon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const ForgotPasswordPage = () => {
  const { t } = useTranslation(["auth", "common"]);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      await apiClient.post("/auth/password/forgot", { email: email.toLowerCase().trim() });
      setStatus("sent");
    } catch (err) {
      console.error(err);
      setError(t("forgotPassword.error"));
      setStatus("idle");
    }
  };

  const isDark = document.documentElement.classList.contains("dark");

  return (
    <div
      style={{
        backgroundImage: `url(${isDark ? "/images/hexWhite.svg" : "/images/hexBlack.svg"})`,
        backgroundPosition: "center",
        backgroundBlendMode: "screen",
        backgroundSize: "67px 116px",
      }}
    >
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/60 px-4 py-12">
        <div className="flex items-center gap-3 font-semibold text-3xl text-primary tracking-tight">
          <LogoIcon className="h-12 w-12" aria-hidden="true" focusable="false" />
          <span className="pride-wordmark">{t("common:appName")}</span>
        </div>
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader>
            <CardTitle>{t("forgotPassword.title")}</CardTitle>
            <CardDescription>{t("forgotPassword.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">{t("forgotPassword.emailLabel")}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  autoCapitalize="none"
                />
              </div>
              <Button className="w-full" type="submit" disabled={status === "sending"}>
                {status === "sending" ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
              </Button>
              {error ? <p className="text-destructive text-sm">{error}</p> : null}
              {status === "sent" ? (
                <p className="text-primary text-sm">{t("forgotPassword.sent")}</p>
              ) : null}
            </form>
          </CardContent>
          <CardFooter className="text-muted-foreground text-sm">
            {t("forgotPassword.remembered")}{" "}
            <Link className="ml-1 text-primary underline-offset-4 hover:underline" to="/login">
              {t("forgotPassword.backToSignIn")}
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
