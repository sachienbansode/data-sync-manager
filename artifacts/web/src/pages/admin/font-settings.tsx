import { useState, useEffect } from "react";
import { getAccessToken } from "@/lib/auth";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Type, Save } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

type FontSettings = {
  fontFamily: string;
  menuFontSize: string;
  bodyFontSize: string;
  headingFontSize: string;
};

const FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Poppins", "Nunito",
  "Source Sans 3", "Ubuntu", "Raleway", "Merriweather", "Georgia",
  "Arial", "Helvetica", "Trebuchet MS", "Times New Roman",
];

async function fetchFontSettings(token: string | null): Promise<FontSettings> {
  const resp = await fetch(`${BASE}api/admin/font-settings`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error("Failed to load font settings");
  return resp.json();
}

async function saveFontSettings(token: string | null, data: FontSettings): Promise<FontSettings> {
  const resp = await fetch(`${BASE}api/admin/font-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error("Failed to save font settings");
  return resp.json();
}

export default function FontSettings() {
  const token = getAccessToken();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<FontSettings>({
    queryKey: ["font-settings"],
    queryFn: () => fetchFontSettings(token),
  });

  const [fontFamily, setFontFamily] = useState("Inter");
  const [menuFontSize, setMenuFontSize] = useState(14);
  const [bodyFontSize, setBodyFontSize] = useState(14);
  const [headingFontSize, setHeadingFontSize] = useState(24);

  useEffect(() => {
    if (data) {
      setFontFamily(data.fontFamily ?? "Inter");
      setMenuFontSize(parseInt(data.menuFontSize) || 14);
      setBodyFontSize(parseInt(data.bodyFontSize) || 14);
      setHeadingFontSize(parseInt(data.headingFontSize) || 24);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (d: FontSettings) => saveFontSettings(token, d),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["font-settings"] });
      // Apply immediately
      const root = document.documentElement;
      root.style.setProperty("--app-font-sans", `"${saved.fontFamily}", sans-serif`);
      root.style.setProperty("--app-font-family", `"${saved.fontFamily}", sans-serif`);
      root.style.setProperty("--app-menu-font-size", `${saved.menuFontSize}px`);
      root.style.setProperty("--app-body-font-size", `${saved.bodyFontSize}px`);
      root.style.setProperty("--app-heading-font-size", `${saved.headingFontSize}px`);
      root.style.fontSize = `${saved.bodyFontSize}px`;
      toast.success("Font settings saved");
    },
    onError: () => toast.error("Failed to save font settings"),
  });

  const handleSave = () => {
    mutation.mutate({
      fontFamily,
      menuFontSize: String(menuFontSize),
      bodyFontSize: String(bodyFontSize),
      headingFontSize: String(headingFontSize),
    });
  };

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted rounded w-64" /><div className="h-64 bg-muted rounded" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Font Settings</h1>
        <p className="text-muted-foreground mt-2">Customise the fonts and sizes used across the application.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-5 w-5 text-primary" />
            Typography
          </CardTitle>
          <CardDescription>Changes are applied immediately and saved globally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Font family */}
          <div className="space-y-2">
            <Label>Font Family</Label>
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map(f => (
                  <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Body font size */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <Label>Body Font Size</Label>
              <span className="text-sm font-mono text-muted-foreground">{bodyFontSize}px</span>
            </div>
            <Slider
              min={11}
              max={20}
              step={1}
              value={[bodyFontSize]}
              onValueChange={([v]) => setBodyFontSize(v)}
              className="w-full"
            />
            <p className="text-sm text-muted-foreground" style={{ fontSize: bodyFontSize }}>
              Preview: The quick brown fox jumps over the lazy dog.
            </p>
          </div>

          {/* Menu font size */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <Label>Sidebar / Menu Font Size</Label>
              <span className="text-sm font-mono text-muted-foreground">{menuFontSize}px</span>
            </div>
            <Slider
              min={11}
              max={18}
              step={1}
              value={[menuFontSize]}
              onValueChange={([v]) => setMenuFontSize(v)}
              className="w-full"
            />
            <p className="text-muted-foreground" style={{ fontSize: menuFontSize }}>
              Preview: Dashboard · Users · Settings
            </p>
          </div>

          {/* Heading font size */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <Label>Heading Font Size</Label>
              <span className="text-sm font-mono text-muted-foreground">{headingFontSize}px</span>
            </div>
            <Slider
              min={16}
              max={40}
              step={1}
              value={[headingFontSize]}
              onValueChange={([v]) => setHeadingFontSize(v)}
              className="w-full"
            />
            <p className="font-bold" style={{ fontSize: headingFontSize }}>
              Preview: Page Title
            </p>
          </div>

          <Button onClick={handleSave} disabled={mutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save Font Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
