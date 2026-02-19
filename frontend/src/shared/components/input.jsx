import "../styles/input.css";

const sizeClass = {
    small: "ui-input-small",
    medium: "ui-input-medium",
    large: "ui-input-large",
    XL: "ui-input-XL",
}

export default function Input({
    size = "medium",
    placeholder = "",
    value,
    onChange,
    type = "text",
    disabled = false,
    ...rest
}) {
    return (
        <input
        className = {`ui-input ${sizeClass[size] || sizeClass.medium}`}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        type={type}
        disabled={disabled}
        {...rest}
        />
    );
};
