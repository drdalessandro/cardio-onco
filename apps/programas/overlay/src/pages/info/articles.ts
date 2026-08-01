// Contenido adaptado al español rioplatense de «Guías de práctica clínica ESC sobre
// cardio-oncología: Información para pacientes» (ESC / SEC / Fundación Española del
// Corazón), manteniendo fidelidad al documento original.

export const GUIDE_PDF_PATH = '/guia-esc-cardio-oncologia-pacientes.pdf';

export type ArticleBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] };

export interface InfoArticle {
  id: string;
  title: string;
  teaser: string;
  readingMinutes: number;
  keyMessage: string;
  body: ArticleBlock[];
  action: { label: string; href: string };
}

export const infoArticles: InfoArticle[] = [
  {
    id: 'que-es-la-cardio-oncologia',
    title: '¿Qué es la cardio-oncología?',
    teaser: 'Por qué algunos tratamientos contra el cáncer pueden afectar el corazón y cómo te cuida tu equipo.',
    readingMinutes: 3,
    keyMessage:
      'El miedo a una posible cardiotoxicidad no debe evitar que recibas el mejor tratamiento para tu enfermedad. La mayoría de los pacientes en tratamiento no desarrolla complicaciones cardiovasculares.',
    body: [
      {
        type: 'paragraph',
        text: 'Existen muchos tratamientos contra el cáncer: cirugía, quimioterapia y radioterapia, además de medicamentos como los tratamientos hormonales, los tratamientos dirigidos y la inmunoterapia. Algunos pueden aumentar el riesgo de problemas del corazón o de la circulación, lo que se conoce como "cardiotoxicidad".',
      },
      { type: 'heading', text: '¿Qué complicaciones pueden aparecer?' },
      {
        type: 'list',
        items: [
          'Presión arterial alta',
          'Infarto o dolor de pecho (angina)',
          'Debilidad del músculo cardíaco, que puede evolucionar a insuficiencia cardíaca',
          'Inflamación del corazón (miocarditis)',
          'Latidos irregulares (arritmias)',
          'Coágulos en una vena (trombosis venosa profunda) o en los pulmones (embolia pulmonar)',
        ],
      },
      {
        type: 'paragraph',
        text: 'Es importante saber que estos tratamientos demostraron ser efectivos contra el cáncer, y que no todas las personas que los reciben desarrollan cardiotoxicidad. El objetivo de la cardio-oncología es que recibas el mejor tratamiento posible y que tu corazón se mantenga sano. Para eso, la guía europea recomienda evaluar el riesgo de complicaciones antes de empezar y hacer un seguimiento cercano durante y después del tratamiento.',
      },
      { type: 'heading', text: 'Un trabajo en equipo' },
      {
        type: 'paragraph',
        text: 'Tu equipo de atención (médicos, enfermeros y otros profesionales) te va a explicar tu tratamiento, vigilar tu corazón y decirte a qué síntomas prestar atención. Vos también tenés un rol clave: avisar cualquier síntoma cardíaco, tomar la medicación para el corazón que te hayan indicado y conversar con tu equipo sobre hábitos saludables.',
      },
    ],
    action: { label: 'Hacer mi check-in semanal', href: '/check-in' },
  },
  {
    id: 'sintomas',
    title: 'Síntomas: a qué prestar atención',
    teaser: 'Los seis síntomas que conviene avisarle a tu equipo lo antes posible.',
    readingMinutes: 2,
    keyMessage:
      'Ante síntomas nuevos, contactá a tu equipo lo antes posible. Detectarlos temprano reduce el riesgo de complicaciones y de tener que interrumpir tu tratamiento contra el cáncer.',
    body: [
      {
        type: 'paragraph',
        text: 'Durante y después del tratamiento contra el cáncer, avisale a tu equipo médico lo antes posible si notás alguno de estos síntomas:',
      },
      {
        type: 'list',
        items: [
          'Dolor o presión en el pecho',
          'Falta de aire o de aliento',
          'Hinchazón en una o ambas piernas',
          'Mareos o aturdimiento',
          'Cansancio mayor al habitual',
          'Latidos rápidos o irregulares (palpitaciones)',
        ],
      },
      {
        type: 'paragraph',
        text: 'No todos los problemas del corazón que aparecen durante el tratamiento se deben al tratamiento: a veces hay que investigar otras causas. Si te hicieron pruebas antes de empezar (pruebas basales), tus médicos van a poder comparar los resultados a lo largo del tiempo para ver si hubo cambios.',
      },
      {
        type: 'paragraph',
        text: 'Si aparece un problema cardíaco o circulatorio durante el tratamiento, los médicos van a decidir si es mejor continuar, pausarlo temporalmente o cambiar a otro tipo de tratamiento, siempre explicándote la situación y decidiendo en conjunto con vos.',
      },
      {
        type: 'paragraph',
        text: 'Por eso el check-in semanal de esta aplicación te pregunta justamente por estos síntomas: es la forma de que tu equipo los detecte a tiempo, incluso entre consulta y consulta.',
      },
    ],
    action: { label: 'Contar cómo me sentí esta semana', href: '/check-in' },
  },
  {
    id: 'pruebas',
    title: 'Las pruebas para cuidar tu corazón',
    teaser: 'Para qué sirve cada estudio (ECG, análisis, ecocardiograma) y cada cuánto se hacen.',
    readingMinutes: 3,
    keyMessage:
      'Que te pidan pruebas no significa que algo anda mal: son la forma de cuidar tu corazón mientras recibís tu tratamiento.',
    body: [
      {
        type: 'paragraph',
        text: 'Si tu tratamiento puede afectar el corazón, es probable que te hagan pruebas antes de empezar (pruebas basales) para conocer tu punto de partida y comparar durante el tratamiento. Estas son las más habituales:',
      },
      {
        type: 'list',
        items: [
          'Electrocardiograma (ECG): registra la actividad eléctrica del corazón.',
          'Análisis de sangre: miden sustancias como el BNP/NT-proBNP y la troponina, que indican si el corazón está sufriendo.',
          'Ecocardiograma (ecocardio): usa ultrasonido para comprobar si el corazón está bombeando bien.',
          'Resonancia magnética cardíaca: evalúa la función y la estructura del corazón.',
          'Tomografía computada cardíaca: ofrece una imagen completa del corazón y de las arterias coronarias.',
        ],
      },
      { type: 'heading', text: '¿Cada cuánto se hacen?' },
      {
        type: 'list',
        items: [
          'Si tu riesgo es bajo: probablemente solo necesites una o dos pruebas durante el tratamiento y una revisión durante el primer año de seguimiento.',
          'Si tu riesgo es moderado: vas a necesitar una vigilancia más cercana y pruebas más frecuentes durante y después del tratamiento.',
          'Si tu riesgo es alto: vas a tener una consulta con cardiología antes de empezar y es posible que te indiquen medicación para proteger el corazón (lo que se conoce como "cardioprotección").',
        ],
      },
      {
        type: 'paragraph',
        text: 'En caso de resultados alterados, se pueden iniciar tratamientos cardíacos para protegerte sin interrumpir tu tratamiento contra el cáncer, siempre que sea posible.',
      },
    ],
    action: { label: 'Ver mis pedidos de estudios', href: '/health-record/study-requests' },
  },
  {
    id: 'estilo-de-vida',
    title: '¿Qué podés hacer vos?',
    teaser: 'Alimentación, actividad física, tabaco, alcohol y tu medicación: lo que está en tus manos.',
    readingMinutes: 3,
    keyMessage: 'Cualquier cambio positivo que hagas suma beneficios para tu salud a largo plazo. ¡No te rindas!',
    body: [
      {
        type: 'paragraph',
        text: 'Un estilo de vida sano puede reducir el riesgo de desarrollar problemas del corazón o de la circulación cuando empezás un tratamiento contra el cáncer, y además mejora tu calidad de vida.',
      },
      {
        type: 'list',
        items: [
          'Comé más frutas y verduras; reducí los alimentos procesados y la comida para llevar; evitá los productos ricos en grasas y azúcares.',
          'Si tenés sobrepeso, consultá con tu equipo cómo bajar de peso de forma segura después del tratamiento. Durante el tratamiento, en general no se recomienda bajar de peso, pero sí llevar una alimentación saludable.',
          'Intentá mantenerte en movimiento con actividad física regular, si te sentís con fuerzas: la meta es de 90 a 150 minutos de ejercicio por semana. Por ejemplo, caminatas a paso rápido de 30 a 40 minutos, 3 o 4 veces por semana.',
          'Dejá de fumar.',
          'Limitá el consumo de alcohol.',
        ],
      },
      { type: 'heading', text: 'Tu medicación para el corazón' },
      {
        type: 'paragraph',
        text: 'Si te recetaron medicamentos para el corazón o la presión, es muy importante que sigas tomándolos durante todo el tiempo que tu equipo indique. Esto se llama "adherencia al tratamiento" y asegura que los medicamentos funcionen correctamente. Si te cuesta conseguirlos o estás pensando en dejarlos, contáselo a tu equipo: hay opciones para ayudarte.',
      },
    ],
    action: { label: 'Registrar mi actividad física', href: '/health-record/vitals/activity-duration' },
  },
  {
    id: 'problema-cardiaco-previo',
    title: 'Ya tengo un problema del corazón',
    teaser: 'Tener un problema cardíaco previo, en general, no impide recibir el mejor tratamiento contra el cáncer.',
    readingMinutes: 2,
    keyMessage:
      'Si tomás pastillas para la presión o para un problema del corazón, NO dejes de tomarlas sin hablar antes con tu médico.',
    body: [
      {
        type: 'paragraph',
        text: 'Los pacientes que ya tienen problemas de corazón tienen un riesgo mayor de desarrollar cardiotoxicidad. Sin embargo, los problemas cardíacos preexistentes generalmente no impiden que recibas el mejor tratamiento posible contra el cáncer.',
      },
      {
        type: 'paragraph',
        text: 'Hablá de tu problema cardíaco con tu equipo: los profesionales que se especializan en oncología, hematología y cardiología te van a asesorar en conjunto.',
      },
      {
        type: 'paragraph',
        text: 'Además, avisale a tu equipo si tenés un marcapasos o un desfibrilador automático implantable, para que puedan planificar estrategias de seguimiento durante la radioterapia.',
      },
      {
        type: 'paragraph',
        text: 'Como parte de la toma de decisiones conjunta, tu equipo va a compartir con vos los riesgos y los beneficios del tratamiento que te propone antes de empezarlo, y va a desarrollar un plan individualizado para tu salud cardíaca durante y después del tratamiento contra el cáncer.',
      },
    ],
    action: { label: '¿Suspendiste una medicación? Contanos', href: '/health-record/medications' },
  },
  {
    id: 'despues-del-tratamiento',
    title: 'Después del tratamiento',
    teaser: 'El cuidado del corazón continúa cuando el tratamiento termina: controles y hábitos.',
    readingMinutes: 2,
    keyMessage:
      'Terminar el tratamiento no es el final del cuidado de tu corazón: mantené los controles y tus hábitos saludables.',
    body: [
      {
        type: 'paragraph',
        text: 'En algunas personas, el tratamiento contra el cáncer (los fármacos y/o la radioterapia) puede afectar el corazón o la circulación meses o incluso años después de terminarlo: por ejemplo, con presión arterial alta, debilidad del músculo cardíaco, enfermedad coronaria, alteraciones del ritmo (arritmias) o problemas en las válvulas.',
      },
      {
        type: 'paragraph',
        text: 'Después de completar el tratamiento, tu médico de cabecera va a ser tu punto de contacto, y el equipo oncológico va a programar revisiones según sea necesario, que pueden ser cada varios meses o una vez por año.',
      },
      {
        type: 'paragraph',
        text: 'Seguir registrando tu presión, tu actividad y tus síntomas en esta aplicación le sirve a tu equipo en cada revisión: es tu historia entre consulta y consulta.',
      },
    ],
    action: { label: 'Ver mi próximo turno', href: '/get-care/appointments' },
  },
];

export const getArticle = (id: string): InfoArticle | undefined => infoArticles.find((article) => article.id === id);
