export type Project = {
  id: string;
  name: string;
  district: string;
  contractorLabel: string;
  accent: string;
};

export const projects: Project[] = [
  {
    id: 'briman-taybah',
    name: 'مشروع بريمان وطيبة',
    district: 'نطاق شمال شرق جدة',
    contractorLabel: 'مدير المشروع',
    accent: 'emerald',
  },
  {
    id: 'east-jeddah',
    name: 'مشروع شرق جدة',
    district: 'الأحياء الشرقية',
    contractorLabel: 'مدير المشروع',
    accent: 'teal',
  },
  {
    id: 'south-jeddah',
    name: 'مشروع جنوب جدة',
    district: 'الأحياء الجنوبية',
    contractorLabel: 'مدير المشروع',
    accent: 'blue',
  },
  {
    id: 'central-jeddah',
    name: 'مشروع وسط جدة',
    district: 'النطاق المركزي',
    contractorLabel: 'مدير المشروع',
    accent: 'green',
  },
];

export function getProject(projectId: string) {
  return projects.find((project) => project.id === projectId);
}
