# SGCS DevOps

Aplicacion Next.js para gestionar cambios de software con flujo agil inspirado en Azure DevOps.

## Comandos

```bash
npm install
npm run db:init
npm run verify:flow
npm run dev
npm run build
```

## Flujo implementado

- Administrador: crea usuarios, proyectos, roles heredados, equipos de trabajo reutilizables y asigna usuarios o equipos a proyectos.
- Solicitante: crea solicitudes detalladas, responde rechazos y aprueba u observa el cambio final.
- Jefe de Proyectos: aprueba, rechaza con negociacion o escala al CCB; tambien envia el cambio final al solicitante.
- CCB: aprueba o rechaza solicitudes escaladas con documento obligatorio.
- Lider Tecnico: crea tarjetas DEV y genera automaticamente una tarjeta QA referenciada.
- Desarrollador: reporta horas, avance, plan de manana, rama GitHub y documentacion.
- QA: revisa tarjetas activadas, aprueba o rechaza; los rechazos incrementan version y devuelven a desarrollo.

Los documentos se guardan en MySQL como `LONGBLOB` para funcionar en Vercel sin almacenamiento local persistente.
