import React, { useState } from 'react';
import { useMedplum, Button } from '@medplum/react';

interface ExportButtonProps {
  patientId: string;
}

export function ExportCardioOncoReport({ patientId }: ExportButtonProps) {
  const medplum = useMedplum();
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      // 1. Ejecutar el Bot pasándole el ID del paciente. 
      // Reemplaza 'id-de-tu-bot-aqui' por el ID real que Medplum le asigne a tu Bot.
      const response = await medplum.executeBot('id-de-tu-bot-aqui', { patientId });

      if (response.status === 'success' && response.binaryUrl) {
        // 2. Descargar el archivo generado
        // Tip: Si devolviste HTML, puedes abrirlo en una ventana nueva para imprimirlo como PDF nativo del navegador,
        // o usar una librería en frontend como 'html2pdf.js' para forzar la descarga en PDF directo.
        
        const fileUrl = `${medplum.getBaseUrl()}${response.binaryUrl}`;
        
        // Abrir en nueva pestaña para imprimir/guardar como PDF
        window.open(fileUrl, '_blank');
      } else {
        alert('Error al generar el reporte: ' + response.message);
      }
    } catch (error) {
      console.error('Error invocando el Bot de exportación:', error);
      alert('Ocurrió un error al intentar exportar los datos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button 
      onClick={handleExport} 
      loading={loading}
      style={{
        backgroundColor: '#28a745', // Color verde amigable
        color: 'white',
        fontWeight: 'bold',
        marginLeft: 'auto' // Si quieres alinearlo a la derecha de la barra de acciones
      }}
    >
      📄 Exportar Resumen Clínico (PDF)
    </Button>
  );
}
