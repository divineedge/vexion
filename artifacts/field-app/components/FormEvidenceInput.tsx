import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, PanResponder, Platform, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export interface EvidenceAnswer { evidenceId: number; fileName?: string; actorId?: number; capturedAt?: string }
export function FormEvidenceInput({ formId, fieldId, kind, value, set, disabled, onUploading }: {
  formId: number; fieldId: string; kind: 'photo' | 'signature'; value?: EvidenceAnswer | null;
  set: (v: EvidenceAnswer | null) => void; disabled: boolean;
  onUploading: (delta:number)=>void;
}) {
  const colors = useColors();
  const svg = useRef<Svg>(null);
  const stroke = useRef('');
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    let active=true, url='';
    setPreview(''); setPreviewError(false);
    if(value) customFetch<Blob>(`/api/form-evidence/${value.evidenceId}`,{responseType:'blob'}).then(blob=>{
      if(Platform.OS==='web'){ if(active){url=URL.createObjectURL(blob);setPreview(url);} }
      else { const reader=new FileReader(); reader.onload=()=>{if(active)setPreview(String(reader.result));};reader.readAsDataURL(blob); }
    }).catch(()=>{if(active)setPreviewError(true);});
    return ()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[value?.evidenceId]);
  const responder=PanResponder.create({
    onStartShouldSetPanResponder:()=>!disabled&&!busy,
    onMoveShouldSetPanResponder:()=>!disabled&&!busy,
    onPanResponderGrant:e=>{stroke.current=`M ${e.nativeEvent.locationX} ${e.nativeEvent.locationY}`;setPaths(p=>[...p,stroke.current]);},
    onPanResponderMove:e=>{stroke.current+=` L ${e.nativeEvent.locationX} ${e.nativeEvent.locationY}`;setPaths(p=>[...p.slice(0,-1),stroke.current]);},
  });
  const upload=async(uri:string,fileName:string,mimeType:string)=>{
    setBusy(true);
    onUploading(1);
    try{
      const local=await fetch(uri),blob=await local.blob();
      if(!['image/png','image/jpeg','image/webp'].includes(mimeType)||blob.size>10*1024*1024)throw new Error('Choose a PNG, JPG, or WebP image up to 10 MB.');
      const intent=await customFetch<{evidenceId:number;uploadURL:string}>('/api/form-evidence/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'job',scopeId:formId,fieldId,fileName,mimeType})});
      const uploaded=await fetch(intent.uploadURL,{method:'PUT',headers:{'Content-Type':mimeType},body:blob});
      if(!uploaded.ok)throw new Error('Image upload failed. Please retry.');
      set(await customFetch<EvidenceAnswer>(`/api/form-evidence/${intent.evidenceId}/finalize`,{method:'POST'}));
    }catch(e){Alert.alert('Could not attach evidence',e instanceof Error?e.message:'Please try again.');}
    finally{setBusy(false);onUploading(-1);}
  };
  const pick=async(camera:boolean)=>{
    try{
      if(camera){
        const permission=await ImagePicker.requestCameraPermissionsAsync();
        if(!permission.granted){Alert.alert('Camera permission needed','Allow camera access in device settings, or choose an existing photo.',[
          {text:'Choose photo',onPress:()=>void pick(false)},
          ...(Platform.OS!=='web'&&!permission.canAskAgain?[{text:'Open Settings',onPress:()=>{void Linking.openSettings().catch(()=>Alert.alert('Open device settings','Please enable camera access in your device settings.'));}}]:[]),
          {text:'Cancel',style:'cancel'},
        ]);return;}
      }
      const result=camera?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:1}):await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:1});
      if(!result.canceled){const asset=result.assets[0];await upload(asset.uri,asset.fileName??'photo.jpg',asset.mimeType??'image/jpeg');}
    }catch(e){Alert.alert('Could not open photos',e instanceof Error?e.message:'Please try again.');}
  };
  const button=(label:string,action:()=>void,inactive=false)=><TouchableOpacity accessibilityRole="button" disabled={busy||disabled||inactive} onPress={action} style={{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,opacity:busy||inactive?0.5:1}}><Text style={{color:colors.foreground}}>{label}</Text></TouchableOpacity>;
  return <View style={{gap:8}}>
    {value && <><Text style={{color:colors.mutedForeground}}>{value.fileName??'Attached evidence'}{value.actorId?` · Staff #${value.actorId}`:''}{value.capturedAt?` · ${new Date(value.capturedAt).toLocaleString()}`:''}</Text>{preview?<Image source={{uri:preview}} style={{width:'100%',height:180,backgroundColor:'white'}} resizeMode="contain"/>:<Text style={{color:colors.mutedForeground}}>{previewError?'Could not load evidence. Reopen the form to retry.':'Loading evidence…'}</Text>}</>}
    {kind==='signature'&&<Text style={{color:colors.mutedForeground,fontSize:12}}>A signature records the mark and question shown. It does not automatically mean agreement or legal certification.</Text>}
    {!disabled && <>
      {kind==='signature'&&<>
        <View {...responder.panHandlers} style={{height:180,backgroundColor:'white',borderWidth:1,borderColor:colors.border,borderRadius:8}}>
          <Svg ref={svg} width="100%" height={180}>{paths.map((d,i)=><Path key={i} d={d} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round"/>)}</Svg>
        </View>
        <View style={{flexDirection:'row',gap:8}}>
          {button('Clear',()=>setPaths([]))}
          {button('Save signature',()=>{
            if(Platform.OS==='web'){
              const source=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180" viewBox="0 0 600 180">${paths.map(d=>`<path d="${d}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>`).join('')}</svg>`;
              const image=document.createElement('img');
              image.onload=()=>{
                const canvas=document.createElement('canvas');canvas.width=600;canvas.height=180;
                canvas.getContext('2d')?.drawImage(image,0,0);
                void upload(canvas.toDataURL('image/png'),'signature.png','image/png');
              };
              image.onerror=()=>Alert.alert('Could not save drawing','Upload a signature image instead.');
              image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
              return;
            }
            svg.current?.toDataURL(base64=>void upload(`data:image/png;base64,${base64}`,'signature.png','image/png'));
          },!paths.some(p=>p.includes(' L ')))}
        </View>
      </>}
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {button(kind==='signature'?'Upload signature image':'Choose photo',()=>void pick(false))}
        {kind==='photo'&&button('Take photo',()=>void pick(true))}
        {value&&button('Remove answer',()=>set(null))}
      </View>
    </>}
    {busy&&<ActivityIndicator color={colors.primary}/>}
  </View>;
}
