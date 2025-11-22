import React from 'react';

interface ImageSourceCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
}

const ImageSourceCard: React.FC<ImageSourceCardProps> = ({ icon, title, description, onClick }) => {
    return (
        <button
            onClick={onClick}
            className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg hover:ring-2 hover:ring-indigo-500 transition-all duration-200 text-left w-full flex flex-col items-center text-center"
        >
            <div className="text-indigo-600 bg-indigo-100 p-4 rounded-full mb-4">
                {icon}
            </div>
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500 mt-1">{description}</p>
        </button>
    )
}

export default ImageSourceCard;
