import { useEffect,useMemo,useRef,useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetWeatherLocations,useUpdateWeatherLocations,getGetWeatherLocationsQueryKey } from "@workspace/api-client-react";
import type { WeatherLocationsSettings as WeatherSettings } from "@workspace/api-client-react";
import { useSettingsAutosave,useAutosaveFields } from "@/hooks/use-settings-autosave";
import { AutosaveIndicator } from "@/components/settings/AutosaveIndicator";
import { Card,CardHeader,CardTitle,CardDescription,CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export function WeatherLocationsSettings(){
  const {user}=useAuth();
  const key=[...getGetWeatherLocationsQueryKey(),{tenantId:user?.tenantId}];
  const query=useGetWeatherLocations({query:{queryKey:key,enabled:!!user}});
  const mutation=useUpdateWeatherLocations();
  const qc=useQueryClient();
  const [text,setText]=useState("");
  const [ready,setReady]=useState(false);
  const ids=useRef(new Map<string,string>());
  useEffect(()=>{
    if(!ready && query.data){
      for(const location of query.data.locations)ids.current.set(location.query.toLowerCase(),location.id);
      setText(query.data.locations.map(location=>location.query).join("\n"));
      setReady(true);
    }
  },[query.data,ready]);
  const locations=useMemo(()=>text.split("\n").map(value=>value.trim()).filter(Boolean).map(query=>{
    const key=query.toLowerCase();
    if(!ids.current.has(key))ids.current.set(key,crypto.randomUUID());
    return {id:ids.current.get(key)!,label:query,query};
  }),[text]);
  const valid=locations.length<=30 && locations.every(x=>x.query.length>=2 && x.query.length<=160)
    &&new Set(locations.map(x=>x.query.toLowerCase())).size===locations.length;
  const autosave=useSettingsAutosave(async patch=>{
    const saved=await mutation.mutateAsync({data:patch as unknown as WeatherSettings});
    qc.setQueryData(key,saved);
  });
  useAutosaveFields({locations},ready,autosave.queue,valid);
  return <Card data-testid="settings-weather-locations">
    <CardHeader><CardTitle>Scheduler forecast locations</CardTitle><CardDescription>Choose the towns or ZIP codes your dispatchers can use. Customer properties will not fill up the forecast selector.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {query.isError?<div className="text-sm text-destructive">Forecast locations could not load. <Button variant="link" onClick={()=>query.refetch()}>Retry</Button></div>:<>
        <label htmlFor="forecast-towns" className="text-sm font-medium">Towns or ZIP codes</label>
        <Textarea id="forecast-towns" data-testid="input-forecast-towns" disabled={!ready} value={text} onChange={event=>setText(event.target.value)} rows={4} placeholder={"Denver, CO\n80202\nLongmont, CO"}/>
        <p className="text-xs text-muted-foreground">One per line, up to 30. Include the state with a town; a town alone uses your business state when available. The first location is the default. Changes save automatically. Forecasts are for planning, not chemical application records.</p>
        {!valid && <p role="alert" className="text-sm text-destructive">Use unique locations, 2–160 characters each, and no more than 30 lines.</p>}
        <AutosaveIndicator status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={()=>void autosave.retry()}/>
      </>}
    </CardContent>
  </Card>;
}
