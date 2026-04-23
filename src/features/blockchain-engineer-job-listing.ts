// This file defines a feature to list blockchain-related engineer job positions with detailed technical requirements

import fs from 'fs';
import path from 'path';

const jobListingPath = path.join(__dirname, 'job-listings.json');

// Function to fetch job listings based on blockchain technology stack
export const getBlockchainEngineerJobs = () => {
  try {
    const data = fs.readFileSync(jobListingPath, 'utf8');
    const jobs = JSON.parse(data);
    return jobs.filter(job => job.technologies.includes('blockchain') || job.technologies.includes('smart contract'));
  } catch (error) {
    console.error('Error reading job listings file:', error);
    return [];
  }
};

// Example usage
const blockchainJobs = getBlockchainEngineerJobs();
console.log(blockchainJobs);