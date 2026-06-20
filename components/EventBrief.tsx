'use client';

type Props = {
  placeName: string;
  country: string;
  text: string;
};

export default function EventBrief({ placeName, country, text }: Props) {
  return (
    <div className="event-brief">
      <div className="place">
        {placeName}
        {country ? `, ${country}` : ''}
      </div>
      <div className="summary">{text || '正在查阅资料…'}</div>
    </div>
  );
}
