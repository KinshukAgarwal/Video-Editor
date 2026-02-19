import "../styles/btn.css";

const sizeClass = {
    small: "ui-button-small",
    medium: "ui-button-medium",
    large: "ui-button-large",
    XL: "ui-button-XL",
}

export default function Btn({
    size = "medium",
    label = "Submit",
    type = "button",
    onClick,
    disabled = false,
    className = "",
    ...rest
}) {
    return (
        <button
        className={`ui-button ${sizeClass[size] || sizeClass.medium} ${className}`.trim()}
        type={type}
        onClick={onClick}
        disabled={disabled}
        {...rest}
        >
            {label}
        </button>
    );
}
