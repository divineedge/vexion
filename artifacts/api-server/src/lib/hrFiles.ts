import multer from "multer";
import { HrError } from "./hrAccess";
import { ObjectStorageService } from "./objectStorage";
export const hrStorage=new ObjectStorageService();
export const hrUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fieldSize:600000,fields:12}});
export function hrFile(file:Express.Multer.File|undefined){
 if(!file)throw new HrError("Choose a document to upload");
 const buffer=file.buffer,ext=file.originalname.toLowerCase().split(".").at(-1);
 let mime:string;
 if(ext==="pdf"&&buffer.subarray(0,5).toString()==="%PDF-")mime="application/pdf";
 else if(["jpg","jpeg"].includes(ext??"")&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)mime="image/jpeg";
 else if(ext==="png"&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime="image/png";
 else if(ext==="webp"&&buffer.subarray(0,4).toString()==="RIFF"&&buffer.subarray(8,12).toString()==="WEBP")mime="image/webp";
 else if(ext==="docx"&&buffer.subarray(0,4).equals(Buffer.from([80,75,3,4])))mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
 else throw new HrError("Upload a PDF, JPG, PNG, WebP, or DOCX document");
 const name=file.originalname.replace(/[^\p{L}\p{N} ._-]/gu,"_").slice(-180)||`document.${ext}`;
 return {fileName:name,mimeType:mime,sizeBytes:buffer.length};
}
