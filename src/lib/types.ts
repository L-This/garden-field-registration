export type GardenDraft = {
  gardenId: string;
  imageName?: string;
  imagePreview?: string;
  location?: {
    lat: number;
    lng: number;
    accuracy?: number;
  };
  status: 'empty' | 'ready' | 'missing-location' | 'sent' | 'duplicate' | 'failed';
  message?: string;
};

export type SubmissionPayload = {
  projectId: string;
  managerName: string;
  submittedAt: string;
  records: GardenDraft[];
};
